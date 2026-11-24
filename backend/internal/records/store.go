package records

import (
	"context"
	"errors"
	"slices"
	"sort"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// Store 封装四大日常记录在 SQLite 中的持久化、分页筛选、每日小计、时间窗口读取与智能默认值聚合。
type Store struct {
	db  *gorm.DB
	now func() time.Time
}

// NewStore 创建日常记录存储实例。
func NewStore(db *gorm.DB) *Store {
	return &Store{
		db:  db,
		now: time.Now,
	}
}

// WithClock 替换内部时钟函数（用于确定性测试）。
func (s *Store) WithClock(fn func() time.Time) *Store {
	if fn != nil {
		s.now = fn
	}
	return s
}

var (
	feedingSubtypes = []string{FeedingSubtypeBreast, FeedingSubtypeFormula, FeedingSubtypeSolid}
	sleepSubtypes   = []string{SleepSubtypeNap, SleepSubtypeNight}
	careSubtypes    = []string{CareSubtypeDiaper, CareSubtypeBath, CareSubtypeOther}
	healthSubtypes  = []string{HealthSubtypeTemperature, HealthSubtypeMedicine, HealthSubtypeGrowth, HealthSubtypeTeeth}
)

func normalizeFilter(f ListFilter) ListFilter {
	if f.Loc == nil {
		f.Loc, _ = timeutil.LoadLocation("")
	}
	if f.Limit <= 0 {
		f.Limit = DefaultListLimit
	}
	if f.Limit > MaxListLimit {
		f.Limit = MaxListLimit
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	if f.Range == "" {
		f.Range = "all"
	}
	return f
}

func isAllowedSubtypeFilter(subtype string, allowed []string) bool {
	return subtype == "" || subtype == "all" || slices.Contains(allowed, subtype)
}

// rangeBoundsUTC 根据 range 参数计算本地自然日范围对应的 UTC 起止边界 [startUTC, endUTC)。
// 7d / 30d 均包含“今天”在内（分别回溯 6 天与 29 天）；range 为空或 "all" 时返回 hasRange=false 表示不限时间。
func (s *Store) rangeBoundsUTC(rangeKey string, loc *time.Location) (startUTC, endUTC string, hasRange bool, err error) {
	todayStart, todayEnd := timeutil.LocalDayBounds(s.now(), loc)
	switch rangeKey {
	case "", "all":
		return "", "", false, nil
	case "today":
		return timeutil.FormatUTC(todayStart), timeutil.FormatUTC(todayEnd), true, nil
	case "7d":
		return timeutil.FormatUTC(todayStart.AddDate(0, 0, -6)), timeutil.FormatUTC(todayEnd), true, nil
	case "30d":
		return timeutil.FormatUTC(todayStart.AddDate(0, 0, -29)), timeutil.FormatUTC(todayEnd), true, nil
	default:
		return "", "", false, &ValidationError{Message: "时间范围参数无效"}
	}
}

type utcRange struct {
	start    time.Time
	end      time.Time
	startUTC string
	endUTC   string
}

// mergedDateRangesUTC 将当前页命中的本地自然日键（map[string]struct{} 是 Go 中零额外内存占用的 Set 惯用法）
// 按升序合并为连续的 UTC 时间区间列表：
// 既避免稀疏分页（如 range=all 跨越数月）全扫中间无关日期，也对连续多日合并为单区间减少 SQL OR 分支。
func mergedDateRangesUTC(keys map[string]struct{}, loc *time.Location) []utcRange {
	if len(keys) == 0 {
		return nil
	}
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		sorted = append(sorted, k)
	}
	sort.Strings(sorted)

	ranges := make([]utcRange, 0, len(sorted))
	for _, k := range sorted {
		dayStart, err := time.ParseInLocation(timeutil.DateLayout, k, loc)
		if err != nil {
			continue
		}
		dayEnd := dayStart.AddDate(0, 0, 1)
		// 若当前日零点紧接上一区间的右边界，直接向右延伸合并，无需新建区间。
		if n := len(ranges); n > 0 && dayStart.Equal(ranges[n-1].end) {
			ranges[n-1].end = dayEnd
			ranges[n-1].endUTC = timeutil.FormatUTC(dayEnd)
			continue
		}
		ranges = append(ranges, utcRange{
			start:    dayStart,
			end:      dayEnd,
			startUTC: timeutil.FormatUTC(dayStart),
			endUTC:   timeutil.FormatUTC(dayEnd),
		})
	}
	return ranges
}

// applyTimeRanges 将一个或多个参数化时间区间附加到查询上。
// overlap=false 用于时刻型记录（recorded_at 落入 [start, end)）；
// overlap=true 用于睡眠区间交集查询（ended_at > start AND started_at < end），确保跨夜睡眠两端自然日都能命中。
func (s *Store) applyTimeRanges(q *gorm.DB, ranges []utcRange, overlap bool) *gorm.DB {
	if len(ranges) == 0 {
		return q
	}
	cond := "recorded_at >= ? AND recorded_at < ?"
	if overlap {
		cond = "ended_at > ? AND started_at < ?"
	}
	if len(ranges) == 1 {
		return q.Where(cond, ranges[0].startUTC, ranges[0].endUTC)
	}
	// 多区间通过独立子查询 group 串联 OR 再整体作为 q.Where(group) 传入，
	// 让 GORM 生成带括号的 `AND ((...) OR (...))`，防止 OR 优先级破坏外层的 baby_id / subtype 条件。
	group := s.db.Where(cond, ranges[0].startUTC, ranges[0].endUTC)
	for _, r := range ranges[1:] {
		group = group.Or(cond, r.startUTC, r.endUTC)
	}
	return q.Where(group)
}

// ==================== Shared Persistence Helpers ====================

// deleteRecord 是四类记录共用的泛型删除辅助函数（类型参数 T 决定目标表模型）；
// 按 id + baby_id 双条件限定归属，未命中任何行时返回 [ErrNotFound]。
func deleteRecord[T any](s *Store, ctx context.Context, babyID, id int64) error {
	var model T
	res := s.db.WithContext(ctx).Where("id = ? AND baby_id = ?", id, babyID).Delete(&model)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// updateRecord 是四类记录共用的泛型更新模板（类型参数 T 为具体记录结构体）：
// 在单个事务内完成「按 babyID+id 读取 → apply 回调写入新字段 → 显式 Select(cols) 落库」。
// GORM 默认的 Updates(&struct) 会跳过 nil 指针字段，因此必须传入全量可编辑列清单 cols，
// 保证跨子类型切换时（如母乳改配方奶）废弃可空列在 SQLite 中被显式置为 NULL。
func updateRecord[T any](s *Store, ctx context.Context, babyID, id int64, cols []string, apply func(*T)) (*T, error) {
	var rec T
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		apply(&rec)
		return tx.Model(&rec).Select(cols).Updates(&rec).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &rec, nil
}

func (s *Store) prepareListFilter(f ListFilter, allowedSubtypes []string, invalidMsg string) (ListFilter, string, string, bool, error) {
	f = normalizeFilter(f)
	if !isAllowedSubtypeFilter(f.Subtype, allowedSubtypes) {
		return f, "", "", false, &ValidationError{Message: invalidMsg}
	}
	startUTC, endUTC, hasRange, err := s.rangeBoundsUTC(f.Range, f.Loc)
	if err != nil {
		return f, "", "", false, err
	}
	return f, startUTC, endUTC, hasRange, nil
}

// queryPage 统一执行筛选计数与分页切片查询，返回当前页记录列表与满足条件的总条数。
func queryPage[T any](s *Store, ctx context.Context, babyID int64, f ListFilter, startUTC, endUTC string, hasRange, overlap bool, orderBy string) ([]T, int64, error) {
	var model T
	base := s.db.WithContext(ctx).Model(&model).Where("baby_id = ?", babyID)
	if f.Subtype != "" && f.Subtype != "all" {
		base = base.Where("subtype = ?", f.Subtype)
	}
	if hasRange {
		if overlap {
			base = base.Where("ended_at > ? AND started_at < ?", startUTC, endUTC)
		} else {
			base = base.Where("recorded_at >= ? AND recorded_at < ?", startUTC, endUTC)
		}
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 使用 make([]T, 0) 而非 nil 切片，确保空结果经 JSON 序列化后返回 `[]` 而非 `null`。
	items := make([]T, 0)
	if total == 0 || int64(f.Offset) >= total {
		return items, total, nil
	}
	if err := base.Order(orderBy).Limit(f.Limit).Offset(f.Offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// pointListSpec 描述单类时刻型记录（喂养/护理/健康）在通用分页小计流程中的差异化配置与累加回调。
type pointListSpec[T any, S any] struct {
	allowedSubtypes []string
	invalidMsg      string
	summaryOrderBy  string
	recordedAt      func(T) string
	accumulate      func(*S, T)
}

// listPointRecords 统一处理喂养、护理、健康三类时刻型记录的分页查询与按日完整小计聚合：
// 先查当前分页，再按涉及的本地自然日合并区间反查全天记录聚合小计，
// 保证每日小计不受分页边界截断影响，同时避免稀疏跨月场景全表扫描。
func listPointRecords[T any, S any](s *Store, ctx context.Context, babyID int64, f ListFilter, spec pointListSpec[T, S]) (*ListResult[T, S], error) {
	f, startUTC, endUTC, hasRange, err := s.prepareListFilter(f, spec.allowedSubtypes, spec.invalidMsg)
	if err != nil {
		return nil, err
	}

	// 1. 拉取当前分页记录。
	items, total, err := queryPage[T](s, ctx, babyID, f, startUTC, endUTC, hasRange, false, "recorded_at DESC, id DESC")
	if err != nil {
		return nil, err
	}

	// 2. 提取当前页命中的所有本地自然日（YYYY-MM-DD）。
	dateKeys := make(map[string]struct{})
	for _, it := range items {
		if ts, parseErr := timeutil.ParseTimestamp(spec.recordedAt(it)); parseErr == nil {
			dateKeys[timeutil.LocalDateKey(ts, f.Loc)] = struct{}{}
		}
	}

	// 3. 反查这些自然日的全部同条件记录并逐条累加生成完整每日小计。
	summaries := make(map[string]S, len(dateKeys))
	if ranges := mergedDateRangesUTC(dateKeys, f.Loc); len(ranges) > 0 {
		var model T
		q := s.db.WithContext(ctx).Model(&model).Where("baby_id = ?", babyID)
		q = s.applyTimeRanges(q, ranges, false)
		if spec.summaryOrderBy != "" {
			q = q.Order(spec.summaryOrderBy)
		}
		if f.Subtype != "" && f.Subtype != "all" {
			q = q.Where("subtype = ?", f.Subtype)
		}
		var allForDays []T
		if err := q.Find(&allForDays).Error; err != nil {
			return nil, err
		}
		for _, r := range allForDays {
			ts, parseErr := timeutil.ParseTimestamp(spec.recordedAt(r))
			if parseErr != nil {
				continue
			}
			key := timeutil.LocalDateKey(ts, f.Loc)
			if _, wanted := dateKeys[key]; !wanted {
				continue
			}
			// Go 的 map 值不可直接取地址修改（&summaries[key] 非法），需拷贝出值类型累加后再写回。
			sum := summaries[key]
			spec.accumulate(&sum, r)
			summaries[key] = sum
		}
	}

	return &ListResult[T, S]{
		Items:          items,
		Total:          total,
		HasMore:        int64(f.Offset+len(items)) < total,
		DailySummaries: summaries,
	}, nil
}

// ==================== Feeding ====================

var feedingUpdateCols = []string{
	"subtype", "feeding_mode", "breast_side", "amount_ml", "duration_min",
	"solid_food", "solid_amount", "acceptance", "recorded_at", "note", "updated_at",
}

func (s *Store) CreateFeeding(ctx context.Context, babyID int64, in FeedingInput) (*FeedingRecord, error) {
	now := s.now()
	clean, err := ValidateFeeding(in, now)
	if err != nil {
		return nil, err
	}
	ts := timeutil.FormatUTC(now)
	rec := FeedingRecord{
		BabyID:      babyID,
		Subtype:     clean.Subtype,
		FeedingMode: clean.FeedingMode,
		BreastSide:  clean.BreastSide,
		AmountML:    clean.AmountML,
		DurationMin: clean.DurationMin,
		SolidFood:   clean.SolidFood,
		SolidAmount: clean.SolidAmount,
		Acceptance:  clean.Acceptance,
		RecordedAt:  clean.RecordedAt,
		Note:        clean.Note,
		CreatedAt:   ts,
		UpdatedAt:   ts,
	}
	if err := s.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) UpdateFeeding(ctx context.Context, babyID, id int64, in FeedingInput) (*FeedingRecord, error) {
	now := s.now()
	clean, err := ValidateFeeding(in, now)
	if err != nil {
		return nil, err
	}
	return updateRecord(s, ctx, babyID, id, feedingUpdateCols, func(rec *FeedingRecord) {
		rec.Subtype = clean.Subtype
		rec.FeedingMode = clean.FeedingMode
		rec.BreastSide = clean.BreastSide
		rec.AmountML = clean.AmountML
		rec.DurationMin = clean.DurationMin
		rec.SolidFood = clean.SolidFood
		rec.SolidAmount = clean.SolidAmount
		rec.Acceptance = clean.Acceptance
		rec.RecordedAt = clean.RecordedAt
		rec.Note = clean.Note
		rec.UpdatedAt = timeutil.FormatUTC(now)
	})
}

func (s *Store) DeleteFeeding(ctx context.Context, babyID, id int64) error {
	return deleteRecord[FeedingRecord](s, ctx, babyID, id)
}

// ListFeeding 按子类型、本地自然日范围与分页参数返回喂养记录及当前页涉及日期的完整每日小计。
func (s *Store) ListFeeding(ctx context.Context, babyID int64, f ListFilter) (*ListResult[FeedingRecord, FeedingDailySummary], error) {
	return listPointRecords(s, ctx, babyID, f, pointListSpec[FeedingRecord, FeedingDailySummary]{
		allowedSubtypes: feedingSubtypes,
		invalidMsg:      "喂养子类型筛选参数无效",
		recordedAt:      func(r FeedingRecord) string { return r.RecordedAt },
		accumulate:      AccumulateFeedingSummary,
	})
}

// ==================== Sleep ====================

var sleepUpdateCols = []string{
	"subtype", "started_at", "ended_at", "duration_min", "note", "updated_at",
}

func (s *Store) CreateSleep(ctx context.Context, babyID int64, in SleepInput) (*SleepRecord, error) {
	now := s.now()
	clean, durationMin, err := ValidateSleep(in, now)
	if err != nil {
		return nil, err
	}
	ts := timeutil.FormatUTC(now)
	rec := SleepRecord{
		BabyID:      babyID,
		Subtype:     clean.Subtype,
		StartedAt:   clean.StartedAt,
		EndedAt:     clean.EndedAt,
		DurationMin: durationMin,
		Note:        clean.Note,
		CreatedAt:   ts,
		UpdatedAt:   ts,
	}
	if err := s.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) UpdateSleep(ctx context.Context, babyID, id int64, in SleepInput) (*SleepRecord, error) {
	now := s.now()
	clean, durationMin, err := ValidateSleep(in, now)
	if err != nil {
		return nil, err
	}
	return updateRecord(s, ctx, babyID, id, sleepUpdateCols, func(rec *SleepRecord) {
		rec.Subtype = clean.Subtype
		rec.StartedAt = clean.StartedAt
		rec.EndedAt = clean.EndedAt
		rec.DurationMin = durationMin
		rec.Note = clean.Note
		rec.UpdatedAt = timeutil.FormatUTC(now)
	})
}

func (s *Store) DeleteSleep(ctx context.Context, babyID, id int64) error {
	return deleteRecord[SleepRecord](s, ctx, babyID, id)
}

// ListSleep 返回与目标本地日期范围有交集的睡眠记录，并按自然日边界切分每日小计。
// 跨夜睡眠会将覆盖到的所有本地自然日均纳入小计键，保证入睡日分组与醒来日统计均准确无漏。
func (s *Store) ListSleep(ctx context.Context, babyID int64, f ListFilter) (*ListResult[SleepRecord, SleepDailySummary], error) {
	f, startUTC, endUTC, hasRange, err := s.prepareListFilter(f, sleepSubtypes, "睡眠子类型筛选参数无效")
	if err != nil {
		return nil, err
	}

	items, total, err := queryPage[SleepRecord](s, ctx, babyID, f, startUTC, endUTC, hasRange, true, "started_at DESC, id DESC")
	if err != nil {
		return nil, err
	}

	dateKeys := make(map[string]struct{})
	for _, it := range items {
		st, err1 := timeutil.ParseTimestamp(it.StartedAt)
		if err1 != nil {
			continue
		}
		// 始终保留入睡日键：即便跨夜睡眠在零点前不足 30 秒（四舍五入为 0 分钟），
		// 前端仍按 started_at 归组查询入睡日小计，不可遗漏该日其余睡眠记录的统计。
		dateKeys[timeutil.LocalDateKey(st, f.Loc)] = struct{}{}
		if et, err2 := timeutil.ParseTimestamp(it.EndedAt); err2 == nil {
			for key := range timeutil.SplitIntervalMinutesByLocalDay(st, et, f.Loc) {
				dateKeys[key] = struct{}{}
			}
		}
	}

	summaries := make(map[string]SleepDailySummary, len(dateKeys))
	if ranges := mergedDateRangesUTC(dateKeys, f.Loc); len(ranges) > 0 {
		q := s.db.WithContext(ctx).Model(&SleepRecord{}).Where("baby_id = ?", babyID)
		q = s.applyTimeRanges(q, ranges, true)
		if f.Subtype != "" && f.Subtype != "all" {
			q = q.Where("subtype = ?", f.Subtype)
		}
		var allForDays []SleepRecord
		if err := q.Find(&allForDays).Error; err != nil {
			return nil, err
		}
		for _, r := range allForDays {
			st, err1 := timeutil.ParseTimestamp(r.StartedAt)
			et, err2 := timeutil.ParseTimestamp(r.EndedAt)
			if err1 != nil || err2 != nil {
				continue
			}
			// 跨夜睡眠按自然日边界切分分钟数，保持与首页看板统计口径一致。
			parts := timeutil.SplitIntervalMinutesByLocalDay(st, et, f.Loc)
			for key, mins := range parts {
				if _, wanted := dateKeys[key]; !wanted {
					continue
				}
				sum := summaries[key]
				AccumulateSleepSummary(&sum, r, mins)
				summaries[key] = sum
			}
		}
	}

	return &ListResult[SleepRecord, SleepDailySummary]{
		Items:          items,
		Total:          total,
		HasMore:        int64(f.Offset+len(items)) < total,
		DailySummaries: summaries,
	}, nil
}

// ==================== Care ====================

var careUpdateCols = []string{
	"subtype", "diaper_kind", "stool_consistency", "stool_color", "care_title",
	"recorded_at", "note", "updated_at",
}

func (s *Store) CreateCare(ctx context.Context, babyID int64, in CareInput) (*CareRecord, error) {
	now := s.now()
	clean, err := ValidateCare(in, now)
	if err != nil {
		return nil, err
	}
	ts := timeutil.FormatUTC(now)
	rec := CareRecord{
		BabyID:           babyID,
		Subtype:          clean.Subtype,
		DiaperKind:       clean.DiaperKind,
		StoolConsistency: clean.StoolConsistency,
		StoolColor:       clean.StoolColor,
		CareTitle:        clean.CareTitle,
		RecordedAt:       clean.RecordedAt,
		Note:             clean.Note,
		CreatedAt:        ts,
		UpdatedAt:        ts,
	}
	if err := s.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) UpdateCare(ctx context.Context, babyID, id int64, in CareInput) (*CareRecord, error) {
	now := s.now()
	clean, err := ValidateCare(in, now)
	if err != nil {
		return nil, err
	}
	return updateRecord(s, ctx, babyID, id, careUpdateCols, func(rec *CareRecord) {
		rec.Subtype = clean.Subtype
		rec.DiaperKind = clean.DiaperKind
		rec.StoolConsistency = clean.StoolConsistency
		rec.StoolColor = clean.StoolColor
		rec.CareTitle = clean.CareTitle
		rec.RecordedAt = clean.RecordedAt
		rec.Note = clean.Note
		rec.UpdatedAt = timeutil.FormatUTC(now)
	})
}

func (s *Store) DeleteCare(ctx context.Context, babyID, id int64) error {
	return deleteRecord[CareRecord](s, ctx, babyID, id)
}

// ListCare 返回筛选分页后的护理记录及当前页涉及本地日期的完整每日小计。
func (s *Store) ListCare(ctx context.Context, babyID int64, f ListFilter) (*ListResult[CareRecord, CareDailySummary], error) {
	return listPointRecords(s, ctx, babyID, f, pointListSpec[CareRecord, CareDailySummary]{
		allowedSubtypes: careSubtypes,
		invalidMsg:      "护理子类型筛选参数无效",
		recordedAt:      func(r CareRecord) string { return r.RecordedAt },
		accumulate:      AccumulateCareSummary,
	})
}

// ==================== Health ====================

var healthUpdateCols = []string{
	"subtype", "temperature_c", "medicine_name", "medicine_dosage",
	"weight_kg", "height_cm", "head_cm", "tooth_note",
	"recorded_at", "note", "updated_at",
}

func (s *Store) CreateHealth(ctx context.Context, babyID int64, in HealthInput) (*HealthRecord, error) {
	now := s.now()
	clean, err := ValidateHealth(in, now)
	if err != nil {
		return nil, err
	}
	ts := timeutil.FormatUTC(now)
	rec := HealthRecord{
		BabyID:         babyID,
		Subtype:        clean.Subtype,
		TemperatureC:   clean.TemperatureC,
		MedicineName:   clean.MedicineName,
		MedicineDosage: clean.MedicineDosage,
		WeightKg:       clean.WeightKg,
		HeightCm:       clean.HeightCm,
		HeadCm:         clean.HeadCm,
		ToothNote:      clean.ToothNote,
		RecordedAt:     clean.RecordedAt,
		Note:           clean.Note,
		CreatedAt:      ts,
		UpdatedAt:      ts,
	}
	if err := s.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) UpdateHealth(ctx context.Context, babyID, id int64, in HealthInput) (*HealthRecord, error) {
	now := s.now()
	clean, err := ValidateHealth(in, now)
	if err != nil {
		return nil, err
	}
	return updateRecord(s, ctx, babyID, id, healthUpdateCols, func(rec *HealthRecord) {
		rec.Subtype = clean.Subtype
		rec.TemperatureC = clean.TemperatureC
		rec.MedicineName = clean.MedicineName
		rec.MedicineDosage = clean.MedicineDosage
		rec.WeightKg = clean.WeightKg
		rec.HeightCm = clean.HeightCm
		rec.HeadCm = clean.HeadCm
		rec.ToothNote = clean.ToothNote
		rec.RecordedAt = clean.RecordedAt
		rec.Note = clean.Note
		rec.UpdatedAt = timeutil.FormatUTC(now)
	})
}

func (s *Store) DeleteHealth(ctx context.Context, babyID, id int64) error {
	return deleteRecord[HealthRecord](s, ctx, babyID, id)
}

// ListHealth 返回筛选分页后的健康记录及当前页涉及本地日期的完整每日小计。
func (s *Store) ListHealth(ctx context.Context, babyID int64, f ListFilter) (*ListResult[HealthRecord, HealthDailySummary], error) {
	return listPointRecords(s, ctx, babyID, f, pointListSpec[HealthRecord, HealthDailySummary]{
		allowedSubtypes: healthSubtypes,
		invalidMsg:      "健康子类型筛选参数无效",
		summaryOrderBy:  "recorded_at DESC, id DESC",
		recordedAt:      func(r HealthRecord) string { return r.RecordedAt },
		accumulate:      AccumulateHealthSummary,
	})
}

// ==================== Window & Highlights Reads ====================

// ReadWindow 读取指定宝宝在 [start, end) 时间窗口内的日常记录快照，
// 供首页看板等聚合模块使用，避免外部模块直接耦合记录表结构与 SQL 谓词。
func (s *Store) ReadWindow(ctx context.Context, babyID int64, start, end time.Time, opts WindowOptions) (*WindowSnapshot, error) {
	snap := &WindowSnapshot{}
	if !end.After(start) {
		return snap, nil
	}

	startUTC := timeutil.FormatUTC(start)
	endUTC := timeutil.FormatUTC(end)

	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&snap.Feedings).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND ended_at > ? AND started_at < ?", babyID, startUTC, endUTC).
		Find(&snap.Sleeps).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&snap.Cares).Error; err != nil {
		return nil, err
	}
	if opts.IncludeHealth {
		if err := s.db.WithContext(ctx).
			Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
			Find(&snap.Healths).Error; err != nil {
			return nil, err
		}
	}

	return snap, nil
}

// ReadLatestHighlights 读取指定宝宝跨时间窗口的最近一次喂养、换尿布与体温标记。
// 此处使用 Limit(1).Find(&rec) 并通过 rec.ID > 0 判断是否命中（而非 First），
// 因为 GORM 的 Find 在无记录时返回 nil error 而非 ErrRecordNotFound，更适合多个可选高亮字段依次读取。
func (s *Store) ReadLatestHighlights(ctx context.Context, babyID int64) (*LatestHighlights, error) {
	hl := &LatestHighlights{}

	var latestFeeding FeedingRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ?", babyID).
		Order("recorded_at DESC, id DESC").
		Limit(1).
		Find(&latestFeeding).Error; err != nil {
		return nil, err
	}
	if latestFeeding.ID > 0 {
		ts := latestFeeding.RecordedAt
		hl.LastFeedingAt = &ts
	}

	var latestTemp HealthRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype = ?", babyID, HealthSubtypeTemperature).
		Order("recorded_at DESC, id DESC").
		Limit(1).
		Find(&latestTemp).Error; err != nil {
		return nil, err
	}
	if latestTemp.ID > 0 && latestTemp.TemperatureC != nil {
		v := *latestTemp.TemperatureC
		ts := latestTemp.RecordedAt
		hl.LatestTempC = &v
		hl.LatestTempAt = &ts
	}

	var latestDiaper CareRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype = ?", babyID, CareSubtypeDiaper).
		Order("recorded_at DESC, id DESC").
		Limit(1).
		Find(&latestDiaper).Error; err != nil {
		return nil, err
	}
	if latestDiaper.ID > 0 {
		ts := latestDiaper.RecordedAt
		hl.LastDiaperAt = &ts
	}

	return hl, nil
}
