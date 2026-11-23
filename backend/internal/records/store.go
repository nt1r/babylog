package records

import (
	"context"
	"errors"
	"sort"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// Store 封装四大日常记录在 SQLite 中的持久化、分页筛选、每日小计与智能默认值聚合。
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

// rangeBoundsUTC 根据 range 参数计算本地自然日范围对应的 UTC 起止边界；若 range=="all" 则 hasRange=false。
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

// dateKeysBoundsUTC 返回当前页所涉及本地自然日键的最小 UTC 起点与最大 UTC 终点，
// 用于对这些日期做二次全量小计查询，避免分页截断导致某天小计偏小。
func dateKeysBoundsUTC(keys map[string]struct{}, loc *time.Location) (string, string, bool) {
	if len(keys) == 0 {
		return "", "", false
	}
	var minKey, maxKey string
	for k := range keys {
		if minKey == "" || k < minKey {
			minKey = k
		}
		if maxKey == "" || k > maxKey {
			maxKey = k
		}
	}
	minDay, err1 := time.ParseInLocation(timeutil.DateLayout, minKey, loc)
	maxDay, err2 := time.ParseInLocation(timeutil.DateLayout, maxKey, loc)
	if err1 != nil || err2 != nil {
		return "", "", false
	}
	return timeutil.FormatUTC(minDay), timeutil.FormatUTC(maxDay.AddDate(0, 0, 1)), true
}

// ==================== Feeding ====================

func (s *Store) CreateFeeding(ctx context.Context, babyID int64, in FeedingInput) (*FeedingRecord, error) {
	now := s.now()
	clean, _, err := ValidateFeeding(in, now)
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
	clean, _, err := ValidateFeeding(in, now)
	if err != nil {
		return nil, err
	}

	var rec FeedingRecord
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

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

		return tx.Model(&rec).Select(
			"subtype", "feeding_mode", "breast_side", "amount_ml", "duration_min",
			"solid_food", "solid_amount", "acceptance", "recorded_at", "note", "updated_at",
		).Updates(&rec).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &rec, nil
}

func (s *Store) DeleteFeeding(ctx context.Context, babyID, id int64) error {
	res := s.db.WithContext(ctx).Where("id = ? AND baby_id = ?", id, babyID).Delete(&FeedingRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// ListFeeding 按子类型、本地自然日范围与分页参数返回喂养记录，
// 并对当前页涉及的所有本地自然日做完整小计聚合，防止跨页截断造成当日奶量显示失真。
func (s *Store) ListFeeding(ctx context.Context, babyID int64, f ListFilter) (*ListResult[FeedingRecord, FeedingDailySummary], error) {
	f = normalizeFilter(f)
	if f.Subtype != "" && f.Subtype != "all" && f.Subtype != "breast" && f.Subtype != "formula" && f.Subtype != "solid" {
		return nil, &ValidationError{Message: "喂养子类型筛选参数无效"}
	}
	startUTC, endUTC, hasRange, err := s.rangeBoundsUTC(f.Range, f.Loc)
	if err != nil {
		return nil, err
	}

	base := s.db.WithContext(ctx).Model(&FeedingRecord{}).Where("baby_id = ?", babyID)
	if f.Subtype != "" && f.Subtype != "all" {
		base = base.Where("subtype = ?", f.Subtype)
	}
	if hasRange {
		base = base.Where("recorded_at >= ? AND recorded_at < ?", startUTC, endUTC)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	items := make([]FeedingRecord, 0)
	if err := base.Order("recorded_at DESC, id DESC").Limit(f.Limit).Offset(f.Offset).Find(&items).Error; err != nil {
		return nil, err
	}

	dateKeys := make(map[string]struct{})
	for _, it := range items {
		if ts, parseErr := timeutil.ParseTimestamp(it.RecordedAt); parseErr == nil {
			dateKeys[timeutil.LocalDateKey(ts, f.Loc)] = struct{}{}
		}
	}

	summaries := make(map[string]FeedingDailySummary, len(dateKeys))
	if sumStart, sumEnd, ok := dateKeysBoundsUTC(dateKeys, f.Loc); ok {
		q := s.db.WithContext(ctx).Model(&FeedingRecord{}).
			Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, sumStart, sumEnd)
		if f.Subtype != "" && f.Subtype != "all" {
			q = q.Where("subtype = ?", f.Subtype)
		}
		var allForDays []FeedingRecord
		if err := q.Find(&allForDays).Error; err != nil {
			return nil, err
		}
		for _, r := range allForDays {
			ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt)
			if parseErr != nil {
				continue
			}
			key := timeutil.LocalDateKey(ts, f.Loc)
			if _, wanted := dateKeys[key]; !wanted {
				continue
			}
			sum := summaries[key]
			AccumulateFeedingSummary(&sum, r)
			summaries[key] = sum
		}
	}

	return &ListResult[FeedingRecord, FeedingDailySummary]{
		Items:          items,
		Total:          total,
		HasMore:        int64(f.Offset+len(items)) < total,
		DailySummaries: summaries,
	}, nil
}

// ==================== Sleep ====================

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

	var rec SleepRecord
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

		rec.Subtype = clean.Subtype
		rec.StartedAt = clean.StartedAt
		rec.EndedAt = clean.EndedAt
		rec.DurationMin = durationMin
		rec.Note = clean.Note
		rec.UpdatedAt = timeutil.FormatUTC(now)

		return tx.Model(&rec).Select(
			"subtype", "started_at", "ended_at", "duration_min", "note", "updated_at",
		).Updates(&rec).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &rec, nil
}

func (s *Store) DeleteSleep(ctx context.Context, babyID, id int64) error {
	res := s.db.WithContext(ctx).Where("id = ? AND baby_id = ?", id, babyID).Delete(&SleepRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// ListSleep 返回与目标本地日期范围有交集的睡眠记录，并按自然日边界切分每日小计。
func (s *Store) ListSleep(ctx context.Context, babyID int64, f ListFilter) (*ListResult[SleepRecord, SleepDailySummary], error) {
	f = normalizeFilter(f)
	if f.Subtype != "" && f.Subtype != "all" && f.Subtype != "nap" && f.Subtype != "night" {
		return nil, &ValidationError{Message: "睡眠子类型筛选参数无效"}
	}
	startUTC, endUTC, hasRange, err := s.rangeBoundsUTC(f.Range, f.Loc)
	if err != nil {
		return nil, err
	}

	base := s.db.WithContext(ctx).Model(&SleepRecord{}).Where("baby_id = ?", babyID)
	if f.Subtype != "" && f.Subtype != "all" {
		base = base.Where("subtype = ?", f.Subtype)
	}
	if hasRange {
		// 只要睡眠区间与目标本地日期范围存在交集（含跨夜睡眠）即纳入列表。
		base = base.Where("ended_at > ? AND started_at < ?", startUTC, endUTC)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	items := make([]SleepRecord, 0)
	if err := base.Order("started_at DESC, id DESC").Limit(f.Limit).Offset(f.Offset).Find(&items).Error; err != nil {
		return nil, err
	}

	dateKeys := make(map[string]struct{})
	for _, it := range items {
		if ts, parseErr := timeutil.ParseTimestamp(it.StartedAt); parseErr == nil {
			dateKeys[timeutil.LocalDateKey(ts, f.Loc)] = struct{}{}
		}
	}

	summaries := make(map[string]SleepDailySummary, len(dateKeys))
	if sumStart, sumEnd, ok := dateKeysBoundsUTC(dateKeys, f.Loc); ok {
		q := s.db.WithContext(ctx).Model(&SleepRecord{}).
			Where("baby_id = ? AND ended_at > ? AND started_at < ?", babyID, sumStart, sumEnd)
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
				sum.TotalMin += mins
				sum.TotalCount++
				if r.Subtype == "night" {
					sum.NightCount++
					sum.NightMin += mins
				} else {
					sum.NapCount++
					sum.NapMin += mins
				}
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

func (s *Store) CreateCare(ctx context.Context, babyID int64, in CareInput) (*CareRecord, error) {
	now := s.now()
	clean, _, err := ValidateCare(in, now)
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
	clean, _, err := ValidateCare(in, now)
	if err != nil {
		return nil, err
	}

	var rec CareRecord
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

		rec.Subtype = clean.Subtype
		rec.DiaperKind = clean.DiaperKind
		rec.StoolConsistency = clean.StoolConsistency
		rec.StoolColor = clean.StoolColor
		rec.CareTitle = clean.CareTitle
		rec.RecordedAt = clean.RecordedAt
		rec.Note = clean.Note
		rec.UpdatedAt = timeutil.FormatUTC(now)

		return tx.Model(&rec).Select(
			"subtype", "diaper_kind", "stool_consistency", "stool_color", "care_title",
			"recorded_at", "note", "updated_at",
		).Updates(&rec).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &rec, nil
}

func (s *Store) DeleteCare(ctx context.Context, babyID, id int64) error {
	res := s.db.WithContext(ctx).Where("id = ? AND baby_id = ?", id, babyID).Delete(&CareRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// ListCare 返回筛选分页后的护理记录及当前页涉及本地日期的完整每日小计。
func (s *Store) ListCare(ctx context.Context, babyID int64, f ListFilter) (*ListResult[CareRecord, CareDailySummary], error) {
	f = normalizeFilter(f)
	if f.Subtype != "" && f.Subtype != "all" && f.Subtype != "diaper" && f.Subtype != "bath" && f.Subtype != "other" {
		return nil, &ValidationError{Message: "护理子类型筛选参数无效"}
	}
	startUTC, endUTC, hasRange, err := s.rangeBoundsUTC(f.Range, f.Loc)
	if err != nil {
		return nil, err
	}

	base := s.db.WithContext(ctx).Model(&CareRecord{}).Where("baby_id = ?", babyID)
	if f.Subtype != "" && f.Subtype != "all" {
		base = base.Where("subtype = ?", f.Subtype)
	}
	if hasRange {
		base = base.Where("recorded_at >= ? AND recorded_at < ?", startUTC, endUTC)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	items := make([]CareRecord, 0)
	if err := base.Order("recorded_at DESC, id DESC").Limit(f.Limit).Offset(f.Offset).Find(&items).Error; err != nil {
		return nil, err
	}

	dateKeys := make(map[string]struct{})
	for _, it := range items {
		if ts, parseErr := timeutil.ParseTimestamp(it.RecordedAt); parseErr == nil {
			dateKeys[timeutil.LocalDateKey(ts, f.Loc)] = struct{}{}
		}
	}

	summaries := make(map[string]CareDailySummary, len(dateKeys))
	if sumStart, sumEnd, ok := dateKeysBoundsUTC(dateKeys, f.Loc); ok {
		q := s.db.WithContext(ctx).Model(&CareRecord{}).
			Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, sumStart, sumEnd)
		if f.Subtype != "" && f.Subtype != "all" {
			q = q.Where("subtype = ?", f.Subtype)
		}
		var allForDays []CareRecord
		if err := q.Find(&allForDays).Error; err != nil {
			return nil, err
		}
		for _, r := range allForDays {
			ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt)
			if parseErr != nil {
				continue
			}
			key := timeutil.LocalDateKey(ts, f.Loc)
			if _, wanted := dateKeys[key]; !wanted {
				continue
			}
			sum := summaries[key]
			AccumulateCareSummary(&sum, r)
			summaries[key] = sum
		}
	}

	return &ListResult[CareRecord, CareDailySummary]{
		Items:          items,
		Total:          total,
		HasMore:        int64(f.Offset+len(items)) < total,
		DailySummaries: summaries,
	}, nil
}

// ==================== Health ====================

func (s *Store) CreateHealth(ctx context.Context, babyID int64, in HealthInput) (*HealthRecord, error) {
	now := s.now()
	clean, _, err := ValidateHealth(in, now)
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
	clean, _, err := ValidateHealth(in, now)
	if err != nil {
		return nil, err
	}

	var rec HealthRecord
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

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

		return tx.Model(&rec).Select(
			"subtype", "temperature_c", "medicine_name", "medicine_dosage",
			"weight_kg", "height_cm", "head_cm", "tooth_note",
			"recorded_at", "note", "updated_at",
		).Updates(&rec).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &rec, nil
}

func (s *Store) DeleteHealth(ctx context.Context, babyID, id int64) error {
	res := s.db.WithContext(ctx).Where("id = ? AND baby_id = ?", id, babyID).Delete(&HealthRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// ListHealth 返回筛选分页后的健康记录及当前页涉及本地日期的完整每日小计。
func (s *Store) ListHealth(ctx context.Context, babyID int64, f ListFilter) (*ListResult[HealthRecord, HealthDailySummary], error) {
	f = normalizeFilter(f)
	if f.Subtype != "" && f.Subtype != "all" && f.Subtype != "temperature" && f.Subtype != "medicine" && f.Subtype != "growth" && f.Subtype != "teeth" {
		return nil, &ValidationError{Message: "健康子类型筛选参数无效"}
	}
	startUTC, endUTC, hasRange, err := s.rangeBoundsUTC(f.Range, f.Loc)
	if err != nil {
		return nil, err
	}

	base := s.db.WithContext(ctx).Model(&HealthRecord{}).Where("baby_id = ?", babyID)
	if f.Subtype != "" && f.Subtype != "all" {
		base = base.Where("subtype = ?", f.Subtype)
	}
	if hasRange {
		base = base.Where("recorded_at >= ? AND recorded_at < ?", startUTC, endUTC)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	items := make([]HealthRecord, 0)
	if err := base.Order("recorded_at DESC, id DESC").Limit(f.Limit).Offset(f.Offset).Find(&items).Error; err != nil {
		return nil, err
	}

	dateKeys := make(map[string]struct{})
	for _, it := range items {
		if ts, parseErr := timeutil.ParseTimestamp(it.RecordedAt); parseErr == nil {
			dateKeys[timeutil.LocalDateKey(ts, f.Loc)] = struct{}{}
		}
	}

	summaries := make(map[string]HealthDailySummary, len(dateKeys))
	if sumStart, sumEnd, ok := dateKeysBoundsUTC(dateKeys, f.Loc); ok {
		q := s.db.WithContext(ctx).Model(&HealthRecord{}).
			Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, sumStart, sumEnd).
			Order("recorded_at DESC, id DESC")
		if f.Subtype != "" && f.Subtype != "all" {
			q = q.Where("subtype = ?", f.Subtype)
		}
		var allForDays []HealthRecord
		if err := q.Find(&allForDays).Error; err != nil {
			return nil, err
		}
		for _, r := range allForDays {
			ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt)
			if parseErr != nil {
				continue
			}
			key := timeutil.LocalDateKey(ts, f.Loc)
			if _, wanted := dateKeys[key]; !wanted {
				continue
			}
			sum := summaries[key]
			sum.TotalCount++
			switch r.Subtype {
			case "temperature":
				sum.TemperatureCount++
				if sum.LatestTempC == nil && r.TemperatureC != nil {
					v := *r.TemperatureC
					sum.LatestTempC = &v
				}
			case "medicine":
				sum.MedicineCount++
			case "growth":
				sum.GrowthCount++
			case "teeth":
				sum.TeethCount++
			}
			summaries[key] = sum
		}
	}

	return &ListResult[HealthRecord, HealthDailySummary]{
		Items:          items,
		Total:          total,
		HasMore:        int64(f.Offset+len(items)) < total,
		DailySummaries: summaries,
	}, nil
}

// ==================== Smart Defaults ====================

// GetSmartDefaults 根据最近历史记录汇总智能默认值，为空历史提供开箱即用的兜底预设。
// 仅回溯最近 60 条喂养（约 1 周）与 40 条健康记录，确保默认值紧贴宝宝当前月龄习惯而非早期历史。
func (s *Store) GetSmartDefaults(ctx context.Context, babyID int64) (*SmartDefaults, error) {
	defaults := &SmartDefaults{
		Feeding: FeedingDefaults{
			LastMilkML:          DefaultStarterMilk,
			FrequentMilkML:      []int{60, 90, 120},
			LastFeedingSubtype:  "formula",
			SuggestedBreastSide: "left",
			RecentSolidFoods:    []string{},
		},
		Health: HealthDefaults{
			LastTemperatureC: DefaultStarterTemp,
			RecentMedicines:  []MedicinePreset{},
		},
		Care: CareDefaults{
			RecentOtherTitles: []string{},
		},
	}

	var feedings []FeedingRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ?", babyID).
		Order("recorded_at DESC, id DESC").
		Limit(60).
		Find(&feedings).Error; err != nil {
		return nil, err
	}

	if len(feedings) > 0 {
		defaults.Feeding.LastFeedingSubtype = feedings[0].Subtype
	}

	type mlStat struct {
		ml         int
		count      int
		firstIndex int
	}
	mlCounts := make(map[int]*mlStat)
	hasLastMilk := false
	hasLastBreast := false
	solidSeen := make(map[string]struct{})

	for idx, f := range feedings {
		if f.AmountML != nil && *f.AmountML > 0 {
			ml := *f.AmountML
			if !hasLastMilk {
				defaults.Feeding.LastMilkML = ml
				hasLastMilk = true
			}
			if st, ok := mlCounts[ml]; ok {
				st.count++
			} else {
				mlCounts[ml] = &mlStat{ml: ml, count: 1, firstIndex: idx}
			}
		}
		if !hasLastBreast && f.Subtype == "breast" && f.FeedingMode != nil && *f.FeedingMode == "direct" && f.BreastSide != nil {
			side := *f.BreastSide
			defaults.Feeding.LastBreastSide = &side
			switch side {
			case "left":
				defaults.Feeding.SuggestedBreastSide = "right"
			case "right":
				defaults.Feeding.SuggestedBreastSide = "left"
			default:
				defaults.Feeding.SuggestedBreastSide = "left"
			}
			hasLastBreast = true
		}
		if f.Subtype == "solid" && f.SolidFood != nil && len(defaults.Feeding.RecentSolidFoods) < 5 {
			food := *f.SolidFood
			if _, exists := solidSeen[food]; !exists {
				solidSeen[food] = struct{}{}
				defaults.Feeding.RecentSolidFoods = append(defaults.Feeding.RecentSolidFoods, food)
			}
		}
	}

	if len(mlCounts) > 0 {
		stats := make([]*mlStat, 0, len(mlCounts))
		for _, st := range mlCounts {
			stats = append(stats, st)
		}
		sort.Slice(stats, func(i, j int) bool {
			if stats[i].count != stats[j].count {
				return stats[i].count > stats[j].count
			}
			return stats[i].firstIndex < stats[j].firstIndex
		})
		top := make([]int, 0, 3)
		topSeen := make(map[int]struct{})
		for _, st := range stats {
			if len(top) >= 3 {
				break
			}
			top = append(top, st.ml)
			topSeen[st.ml] = struct{}{}
		}
		for _, fallback := range []int{60, 90, 120} {
			if len(top) >= 3 {
				break
			}
			if _, ok := topSeen[fallback]; !ok {
				top = append(top, fallback)
				topSeen[fallback] = struct{}{}
			}
		}
		// 高频前 3 档按升序展示给前端胶囊，符合用户从少到多的视觉直觉。
		sort.Ints(top)
		defaults.Feeding.FrequentMilkML = top
	}

	var healths []HealthRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype IN ?", babyID, []string{"temperature", "medicine"}).
		Order("recorded_at DESC, id DESC").
		Limit(40).
		Find(&healths).Error; err != nil {
		return nil, err
	}

	hasTemp := false
	medSeen := make(map[string]struct{})
	for _, h := range healths {
		if !hasTemp && h.Subtype == "temperature" && h.TemperatureC != nil {
			defaults.Health.LastTemperatureC = *h.TemperatureC
			hasTemp = true
		}
		if h.Subtype == "medicine" && h.MedicineName != nil && len(defaults.Health.RecentMedicines) < 5 {
			name := *h.MedicineName
			if _, exists := medSeen[name]; !exists {
				medSeen[name] = struct{}{}
				dosage := ""
				if h.MedicineDosage != nil {
					dosage = *h.MedicineDosage
				}
				defaults.Health.RecentMedicines = append(defaults.Health.RecentMedicines, MedicinePreset{
					Name:   name,
					Dosage: dosage,
				})
			}
		}
	}

	var cares []CareRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype = ?", babyID, "other").
		Order("recorded_at DESC, id DESC").
		Limit(30).
		Find(&cares).Error; err != nil {
		return nil, err
	}
	careSeen := make(map[string]struct{})
	for _, c := range cares {
		if c.CareTitle != nil && len(defaults.Care.RecentOtherTitles) < 5 {
			title := *c.CareTitle
			if _, exists := careSeen[title]; !exists {
				careSeen[title] = struct{}{}
				defaults.Care.RecentOtherTitles = append(defaults.Care.RecentOtherTitles, title)
			}
		}
	}

	return defaults, nil
}
