package export

import (
	"context"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

const (
	defaultExportDays = 30
	minExportDays     = 1
	maxExportDays     = 366

	catFeeding = "feeding"
	catSleep   = "sleep"
	catCare    = "care"
	catHealth  = "health"
	catGrowth  = "growth"
)

var canonicalCategories = []string{catFeeding, catSleep, catCare, catHealth, catGrowth}

// ValidationError 表示导出查询参数不合法，映射为 HTTP 400 中文错误提示。
type ValidationError struct {
	Message string
}

// Error 实现标准 error 接口，返回可直接展示给家长的中文校验消息。
func (e *ValidationError) Error() string { return e.Message }

// Params 封装一次多 Sheet Excel 导出的宝宝归属信息、原始查询参数与本地时区。
// CategoriesProvided 用于区分“未传 categories 参数（默认全选）”与“显式传入空值 ?categories=（返回 400）”。
type Params struct {
	BabyID             int64
	BabyNickname       string
	DaysRaw            string
	StartRaw           string
	EndRaw             string
	CategoriesRaw      string
	CategoriesProvided bool
	Loc                *time.Location
}

// Result 封装已生成的多 Sheet `.xlsx` 字节内容与 ASCII/UTF-8 双下载文件名。
type Result struct {
	FilenameASCII string
	FilenameUTF8  string
	Content       []byte
}

// Service 负责校验导出参数、按本地时区读取宝宝照护窗口并构建多 Sheet Excel 工作簿。
type Service struct {
	store *records.Store
	now   func() time.Time
}

// NewService 创建数据导出服务实例。
func NewService(store *records.Store) *Service {
	return &Service{
		store: store,
		now:   time.Now,
	}
}

// WithClock 替换内部时钟函数（用于确定性测试）。
func (s *Service) WithClock(fn func() time.Time) *Service {
	if fn != nil {
		s.now = fn
	}
	return s
}

type resolvedQuery struct {
	startDay   time.Time
	endDay     time.Time
	windowEnd  time.Time
	dateKeys   []string
	categories []string
	catSet     map[string]bool
}

func (s *Service) resolveQuery(params Params, loc *time.Location) (resolvedQuery, error) {
	daysRaw := strings.TrimSpace(params.DaysRaw)
	startRaw := strings.TrimSpace(params.StartRaw)
	endRaw := strings.TrimSpace(params.EndRaw)

	if daysRaw != "" && (startRaw != "" || endRaw != "") {
		return resolvedQuery{}, &ValidationError{Message: "请勿同时传入天数与自定义起止日期"}
	}

	var startDay, endDay time.Time
	if startRaw != "" || endRaw != "" {
		if startRaw == "" || endRaw == "" {
			return resolvedQuery{}, &ValidationError{Message: "请同时提供开始日期和结束日期"}
		}
		st, err1 := time.ParseInLocation(timeutil.DateLayout, startRaw, loc)
		et, err2 := time.ParseInLocation(timeutil.DateLayout, endRaw, loc)
		if err1 != nil || err2 != nil {
			return resolvedQuery{}, &ValidationError{Message: "日期格式无效，请使用 YYYY-MM-DD"}
		}
		if et.Before(st) {
			return resolvedQuery{}, &ValidationError{Message: "结束日期不能早于开始日期"}
		}
		// 单次导出上限 366 天（含起止两日），以日历步进判断避免夏令时 23h/25h 误差。
		if !et.Before(st.AddDate(0, 0, maxExportDays)) {
			return resolvedQuery{}, &ValidationError{Message: fmt.Sprintf("单次导出时间范围不能超过 %d 天", maxExportDays)}
		}
		startDay, endDay = st, et
	} else {
		days := defaultExportDays
		if daysRaw != "" {
			var parsed int
			if _, err := fmt.Sscanf(daysRaw, "%d", &parsed); err != nil || fmt.Sprintf("%d", parsed) != daysRaw || parsed < minExportDays || parsed > maxExportDays {
				return resolvedQuery{}, &ValidationError{Message: fmt.Sprintf("导出天数应在 %d 至 %d 之间", minExportDays, maxExportDays)}
			}
			days = parsed
		}
		todayStart, _ := timeutil.LocalDayBounds(s.now(), loc)
		startDay = todayStart.AddDate(0, 0, -(days - 1))
		endDay = todayStart
	}

	cats, err := parseCategories(params.CategoriesRaw, params.CategoriesProvided)
	if err != nil {
		return resolvedQuery{}, err
	}
	catSet := make(map[string]bool, len(cats))
	for _, c := range cats {
		catSet[c] = true
	}

	var dateKeys []string
	for cur := startDay; !cur.After(endDay); cur = cur.AddDate(0, 0, 1) {
		dateKeys = append(dateKeys, cur.Format(timeutil.DateLayout))
	}

	return resolvedQuery{
		startDay:   startDay,
		endDay:     endDay,
		windowEnd:  endDay.AddDate(0, 0, 1),
		dateKeys:   dateKeys,
		categories: cats,
		catSet:     catSet,
	}, nil
}

func parseCategories(raw string, provided bool) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if !provided && trimmed == "" {
		return slices.Clone(canonicalCategories), nil
	}
	if trimmed == "" {
		return nil, &ValidationError{Message: "导出指标类型无效"}
	}
	seen := make(map[string]bool, len(canonicalCategories))
	for _, part := range strings.Split(trimmed, ",") {
		token := strings.TrimSpace(part)
		if token == "" || !slices.Contains(canonicalCategories, token) {
			return nil, &ValidationError{Message: "导出指标类型无效"}
		}
		seen[token] = true
	}
	result := make([]string, 0, len(seen))
	for _, c := range canonicalCategories {
		if seen[c] {
			result = append(result, c)
		}
	}
	return result, nil
}

// BuildXLSX 校验参数并读取目标宝宝窗口内记录，生成含「按日汇总」与所选明细 Sheet 的标准 `.xlsx` 文件。
func (s *Service) BuildXLSX(ctx context.Context, params Params) (*Result, error) {
	if params.BabyID <= 0 {
		return nil, &ValidationError{Message: "无效的宝宝编号"}
	}
	loc := params.Loc
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}

	q, err := s.resolveQuery(params, loc)
	if err != nil {
		return nil, err
	}

	// ReadWindow 对睡眠记录按区间交集查询（ended_at > start AND started_at < end），
	// 因此跨窗口起点的夜觉会出现在「睡眠明细」中并仅将落入窗口内的分钟数切分到「按日汇总」。
	snap, err := s.store.ReadWindow(ctx, params.BabyID, q.startDay, q.windowEnd)
	if err != nil {
		return nil, err
	}

	// 按时间升序排列明细记录（时间戳相同时以 ID 升序破平局），便于按时间轴审阅或就医查看。
	sort.Slice(snap.Feedings, func(i, j int) bool {
		if snap.Feedings[i].RecordedAt != snap.Feedings[j].RecordedAt {
			return snap.Feedings[i].RecordedAt < snap.Feedings[j].RecordedAt
		}
		return snap.Feedings[i].ID < snap.Feedings[j].ID
	})
	sort.Slice(snap.Sleeps, func(i, j int) bool {
		if snap.Sleeps[i].StartedAt != snap.Sleeps[j].StartedAt {
			return snap.Sleeps[i].StartedAt < snap.Sleeps[j].StartedAt
		}
		return snap.Sleeps[i].ID < snap.Sleeps[j].ID
	})
	sort.Slice(snap.Cares, func(i, j int) bool {
		if snap.Cares[i].RecordedAt != snap.Cares[j].RecordedAt {
			return snap.Cares[i].RecordedAt < snap.Cares[j].RecordedAt
		}
		return snap.Cares[i].ID < snap.Cares[j].ID
	})
	sort.Slice(snap.Healths, func(i, j int) bool {
		if snap.Healths[i].RecordedAt != snap.Healths[j].RecordedAt {
			return snap.Healths[i].RecordedAt < snap.Healths[j].RecordedAt
		}
		return snap.Healths[i].ID < snap.Healths[j].ID
	})

	var clinicalHealths []records.HealthRecord
	var growthRecords []records.HealthRecord
	for _, r := range snap.Healths {
		switch r.Subtype {
		case records.HealthSubtypeTemperature, records.HealthSubtypeMedicine:
			clinicalHealths = append(clinicalHealths, r)
		case records.HealthSubtypeGrowth, records.HealthSubtypeTeeth:
			growthRecords = append(growthRecords, r)
		}
	}

	sheets := make([]sheetSpec, 0, 1+len(q.categories))
	sheets = append(sheets, buildDailySummarySheet(q, snap, clinicalHealths, growthRecords, loc))

	for _, cat := range q.categories {
		switch cat {
		case catFeeding:
			sheets = append(sheets, buildFeedingDetailSheet(snap.Feedings, loc))
		case catSleep:
			sheets = append(sheets, buildSleepDetailSheet(snap.Sleeps, loc))
		case catCare:
			sheets = append(sheets, buildCareDetailSheet(snap.Cares, loc))
		case catHealth:
			sheets = append(sheets, buildHealthDetailSheet(clinicalHealths, loc))
		case catGrowth:
			sheets = append(sheets, buildGrowthDetailSheet(growthRecords, loc))
		}
	}

	content, err := writeXLSXWorkbook(sheets)
	if err != nil {
		return nil, err
	}

	startKey := q.startDay.Format(timeutil.DateLayout)
	endKey := q.endDay.Format(timeutil.DateLayout)
	startCompact := strings.ReplaceAll(startKey, "-", "")
	endCompact := strings.ReplaceAll(endKey, "-", "")
	nickname := sanitizeFilenameSegment(params.BabyNickname)
	if nickname == "" {
		nickname = "宝宝"
	}

	return &Result{
		FilenameASCII: fmt.Sprintf("babylog-export-%s-%s.xlsx", startCompact, endCompact),
		FilenameUTF8:  fmt.Sprintf("%s-照护记录-%s至%s.xlsx", nickname, startKey, endKey),
		Content:       content,
	}, nil
}

// sanitizeFilenameSegment 清理宝宝昵称中的路径分隔符、引号、分号与控制字符，
// 防止文件名非法或向 Content-Disposition 响应头注入额外参数。
func sanitizeFilenameSegment(raw string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		if r < 0x20 || r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' || r == ';' {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

type growthDaySummary struct {
	weightKg *float64
	heightCm *float64
	headCm   *float64
	teeth    []string
}

func buildDailySummarySheet(
	q resolvedQuery,
	snap *records.WindowSnapshot,
	clinicalHealths []records.HealthRecord,
	growthRecords []records.HealthRecord,
	loc *time.Location,
) sheetSpec {
	headers := []string{"日期"}
	if q.catSet[catFeeding] {
		headers = append(headers, "总奶量(ml)", "配方奶(ml)", "配方奶次数", "瓶喂母乳(ml)", "瓶喂母乳次数", "亲喂时长(分钟)", "亲喂次数", "辅食次数", "喂养总次数")
	}
	if q.catSet[catSleep] {
		headers = append(headers, "总睡眠(小时)", "夜间睡眠(小时)", "白天小睡(小时)", "小睡次数")
	}
	if q.catSet[catCare] {
		headers = append(headers, "嘘嘘次数", "便便次数", "洗澡次数", "其他护理次数")
	}
	if q.catSet[catHealth] {
		headers = append(headers, "最高体温(℃)", "用药次数")
	}
	if q.catSet[catGrowth] {
		headers = append(headers, "体重(kg)", "身高(cm)", "头围(cm)", "出牙记录")
	}

	var feedingByDay map[string]records.FeedingDailySummary
	if q.catSet[catFeeding] {
		feedingByDay = records.SummarizeFeedingByLocalDay(snap.Feedings, loc)
	}

	var sleepByDay map[string]records.SleepDailySummary
	if q.catSet[catSleep] {
		sleepByDay = records.SummarizeSleepByLocalDay(snap.Sleeps, loc)
	}

	var careByDay map[string]records.CareDailySummary
	if q.catSet[catCare] {
		careByDay = records.SummarizeCareByLocalDay(snap.Cares, loc)
	}

	var healthByDay map[string]records.ClinicalHealthDayStats
	if q.catSet[catHealth] {
		healthByDay = records.SummarizeClinicalHealthByLocalDay(clinicalHealths, loc)
	}

	growthByDay := make(map[string]*growthDaySummary)
	if q.catSet[catGrowth] {
		// 依赖调用方已将 growthRecords 按 (RecordedAt, ID) 升序排列：
		// 同日存在多条部分体格测量时按字段后者覆盖前者，最终保留当日各维度最新非空测量值。
		for _, r := range growthRecords {
			ts, err := timeutil.ParseTimestamp(r.RecordedAt)
			if err != nil {
				continue
			}
			key := timeutil.LocalDateKey(ts, loc)
			agg := growthByDay[key]
			if agg == nil {
				agg = &growthDaySummary{}
				growthByDay[key] = agg
			}
			if r.Subtype == records.HealthSubtypeGrowth {
				if r.WeightKg != nil {
					v := *r.WeightKg
					agg.weightKg = &v
				}
				if r.HeightCm != nil {
					v := *r.HeightCm
					agg.heightCm = &v
				}
				if r.HeadCm != nil {
					v := *r.HeadCm
					agg.headCm = &v
				}
			} else if r.Subtype == records.HealthSubtypeTeeth && r.ToothNote != nil && *r.ToothNote != "" {
				agg.teeth = append(agg.teeth, *r.ToothNote)
			}
		}
	}

	rows := make([][]cellValue, 0, len(q.dateKeys))
	for _, key := range q.dateKeys {
		row := make([]cellValue, 0, len(headers))
		row = append(row, textCell(key))

		if q.catSet[catFeeding] {
			f := feedingByDay[key]
			row = append(row,
				intCell(f.TotalML),
				intCell(f.FormulaML),
				intCell(f.FormulaCount),
				intCell(f.BottleBreastML),
				intCell(f.BottleBreastCount),
				intCell(f.DirectBreastMin),
				intCell(f.DirectBreastCount),
				intCell(f.SolidCount),
				intCell(f.TotalCount),
			)
		}

		if q.catSet[catSleep] {
			sl := sleepByDay[key]
			napMin := max(sl.TotalMin-sl.NightMin, 0)
			row = append(row,
				numCell(round1(float64(sl.TotalMin)/60.0)),
				numCell(round1(float64(sl.NightMin)/60.0)),
				numCell(round1(float64(napMin)/60.0)),
				intCell(sl.NapCount),
			)
		}

		if q.catSet[catCare] {
			c := careByDay[key]
			row = append(row,
				intCell(c.PeeCount),
				intCell(c.PoopCount),
				intCell(c.BathCount),
				intCell(c.OtherCount),
			)
		}

		if q.catSet[catHealth] {
			h := healthByDay[key]
			if h.MaxTempC != nil {
				row = append(row, numCell(*h.MaxTempC))
			} else {
				row = append(row, textCell(""))
			}
			row = append(row, intCell(h.MedicineCount))
		}

		if q.catSet[catGrowth] {
			agg := growthByDay[key]
			if agg != nil && agg.weightKg != nil {
				row = append(row, numCell(*agg.weightKg))
			} else {
				row = append(row, textCell(""))
			}
			if agg != nil && agg.heightCm != nil {
				row = append(row, numCell(*agg.heightCm))
			} else {
				row = append(row, textCell(""))
			}
			if agg != nil && agg.headCm != nil {
				row = append(row, numCell(*agg.headCm))
			} else {
				row = append(row, textCell(""))
			}
			if agg != nil && len(agg.teeth) > 0 {
				row = append(row, textCell(strings.Join(agg.teeth, "；")))
			} else {
				row = append(row, textCell(""))
			}
		}

		rows = append(rows, row)
	}

	return sheetSpec{
		Name:    "按日汇总",
		Headers: headers,
		Rows:    rows,
	}
}

func buildFeedingDetailSheet(items []records.FeedingRecord, loc *time.Location) sheetSpec {
	headers := []string{"日期", "时间", "类型", "方式/侧别", "奶量(ml)", "时长(分钟)", "辅食名称", "份量", "接受度", "备注"}
	rows := make([][]cellValue, 0, len(items))
	for _, r := range items {
		dateStr, timeStr := formatLocalDateAndTime(r.RecordedAt, loc)
		var kindLabel, detailLabel string
		var mlCell, minCell cellValue
		var solidFood, solidAmount, acceptance string

		switch r.Subtype {
		case records.FeedingSubtypeFormula:
			kindLabel = "配方奶"
			if r.AmountML != nil {
				mlCell = intCell(*r.AmountML)
			}
		case records.FeedingSubtypeBreast:
			if r.FeedingMode != nil && *r.FeedingMode == "bottle" {
				kindLabel = "瓶喂母乳"
				detailLabel = "瓶喂"
				if r.AmountML != nil {
					mlCell = intCell(*r.AmountML)
				}
			} else {
				kindLabel = "亲喂"
				detailLabel = formatBreastSide(r.BreastSide)
				if r.DurationMin != nil {
					minCell = intCell(*r.DurationMin)
				}
			}
		case records.FeedingSubtypeSolid:
			kindLabel = "辅食"
			if r.SolidFood != nil {
				solidFood = *r.SolidFood
			}
			if r.SolidAmount != nil {
				solidAmount = *r.SolidAmount
			}
			acceptance = formatAcceptance(r.Acceptance)
		}

		rows = append(rows, []cellValue{
			textCell(dateStr),
			textCell(timeStr),
			textCell(kindLabel),
			textCell(detailLabel),
			mlCell,
			minCell,
			textCell(solidFood),
			textCell(solidAmount),
			textCell(acceptance),
			textCell(r.Note),
		})
	}
	return sheetSpec{
		Name:      "喂养明细",
		Headers:   headers,
		Rows:      rows,
		ColWidths: []float64{13, 9, 12, 12, 12, 12, 16, 12, 10, 26},
	}
}

func buildSleepDetailSheet(items []records.SleepRecord, loc *time.Location) sheetSpec {
	headers := []string{"入睡日期", "入睡时间", "醒来时间", "类型", "时长(分钟)", "时长(小时)", "备注"}
	rows := make([][]cellValue, 0, len(items))
	for _, r := range items {
		startDate, startTime := formatLocalDateAndTime(r.StartedAt, loc)
		endDate, endTime := formatLocalDateAndTime(r.EndedAt, loc)
		endDisplay := endTime
		if endDate != "" && endDate != startDate {
			endDisplay = endDate + " " + endTime
		}
		kindLabel := "白天小睡"
		if r.Subtype == records.SleepSubtypeNight {
			kindLabel = "夜间整觉"
		}
		rows = append(rows, []cellValue{
			textCell(startDate),
			textCell(startTime),
			textCell(endDisplay),
			textCell(kindLabel),
			intCell(r.DurationMin),
			numCell(round1(float64(r.DurationMin) / 60.0)),
			textCell(r.Note),
		})
	}
	return sheetSpec{
		Name:      "睡眠明细",
		Headers:   headers,
		Rows:      rows,
		ColWidths: []float64{13, 10, 18, 12, 12, 12, 26},
	}
}

func buildCareDetailSheet(items []records.CareRecord, loc *time.Location) sheetSpec {
	headers := []string{"日期", "时间", "类型", "详情", "便便性状", "便便颜色", "备注"}
	rows := make([][]cellValue, 0, len(items))
	for _, r := range items {
		dateStr, timeStr := formatLocalDateAndTime(r.RecordedAt, loc)
		var kindLabel, detailLabel, consistency, color string
		switch r.Subtype {
		case records.CareSubtypeDiaper:
			kindLabel = "换尿布"
			detailLabel = formatDiaperKind(r.DiaperKind)
			consistency = formatStoolConsistency(r.StoolConsistency)
			color = formatStoolColor(r.StoolColor)
		case records.CareSubtypeBath:
			kindLabel = "洗澡"
		case records.CareSubtypeOther:
			kindLabel = "其他护理"
			if r.CareTitle != nil {
				detailLabel = *r.CareTitle
			}
		}
		rows = append(rows, []cellValue{
			textCell(dateStr),
			textCell(timeStr),
			textCell(kindLabel),
			textCell(detailLabel),
			textCell(consistency),
			textCell(color),
			textCell(r.Note),
		})
	}
	return sheetSpec{
		Name:      "护理明细",
		Headers:   headers,
		Rows:      rows,
		ColWidths: []float64{13, 9, 12, 16, 12, 12, 26},
	}
}

func buildHealthDetailSheet(items []records.HealthRecord, loc *time.Location) sheetSpec {
	headers := []string{"日期", "时间", "类型", "体温(℃)", "药品名称", "剂量", "备注"}
	rows := make([][]cellValue, 0, len(items))
	for _, r := range items {
		dateStr, timeStr := formatLocalDateAndTime(r.RecordedAt, loc)
		var kindLabel, medName, medDosage string
		var tempCell cellValue
		if r.Subtype == records.HealthSubtypeTemperature {
			kindLabel = "体温"
			if r.TemperatureC != nil {
				tempCell = numCell(*r.TemperatureC)
			}
		} else {
			kindLabel = "用药"
			if r.MedicineName != nil {
				medName = *r.MedicineName
			}
			if r.MedicineDosage != nil {
				medDosage = *r.MedicineDosage
			}
		}
		rows = append(rows, []cellValue{
			textCell(dateStr),
			textCell(timeStr),
			textCell(kindLabel),
			tempCell,
			textCell(medName),
			textCell(medDosage),
			textCell(r.Note),
		})
	}
	return sheetSpec{
		Name:      "健康明细",
		Headers:   headers,
		Rows:      rows,
		ColWidths: []float64{13, 9, 10, 11, 18, 14, 26},
	}
}

func buildGrowthDetailSheet(items []records.HealthRecord, loc *time.Location) sheetSpec {
	headers := []string{"日期", "类型", "体重(kg)", "身高(cm)", "头围(cm)", "出牙说明", "备注"}
	rows := make([][]cellValue, 0, len(items))
	for _, r := range items {
		dateStr, _ := formatLocalDateAndTime(r.RecordedAt, loc)
		var kindLabel, toothNote string
		var weightCell, heightCell, headCell cellValue
		if r.Subtype == records.HealthSubtypeTeeth {
			kindLabel = "长牙"
			if r.ToothNote != nil {
				toothNote = *r.ToothNote
			}
		} else {
			kindLabel = "生长测量"
			if r.WeightKg != nil {
				weightCell = numCell(*r.WeightKg)
			}
			if r.HeightCm != nil {
				heightCell = numCell(*r.HeightCm)
			}
			if r.HeadCm != nil {
				headCell = numCell(*r.HeadCm)
			}
		}
		rows = append(rows, []cellValue{
			textCell(dateStr),
			textCell(kindLabel),
			weightCell,
			heightCell,
			headCell,
			textCell(toothNote),
			textCell(r.Note),
		})
	}
	return sheetSpec{
		Name:      "生长发育明细",
		Headers:   headers,
		Rows:      rows,
		ColWidths: []float64{13, 12, 11, 11, 11, 20, 26},
	}
}

func formatLocalDateAndTime(raw string, loc *time.Location) (string, string) {
	ts, err := timeutil.ParseTimestamp(raw)
	if err != nil {
		return "", ""
	}
	local := ts.In(loc)
	return local.Format(timeutil.DateLayout), local.Format("15:04")
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func formatBreastSide(p *string) string {
	if p == nil {
		return ""
	}
	switch *p {
	case "left":
		return "左侧"
	case "right":
		return "右侧"
	case "both":
		return "双侧"
	default:
		return *p
	}
}

func formatAcceptance(p *string) string {
	if p == nil {
		return ""
	}
	switch *p {
	case "like":
		return "爱吃"
	case "neutral":
		return "一般"
	case "dislike":
		return "抗拒"
	default:
		return *p
	}
}

func formatDiaperKind(p *string) string {
	if p == nil {
		return ""
	}
	switch *p {
	case "pee":
		return "嘘嘘"
	case "poop":
		return "便便"
	case "both":
		return "嘘嘘 + 便便"
	default:
		return *p
	}
}

func formatStoolConsistency(p *string) string {
	if p == nil {
		return ""
	}
	switch *p {
	case "watery":
		return "稀水"
	case "soft":
		return "软便"
	case "formed":
		return "成型"
	case "hard":
		return "偏干"
	default:
		return *p
	}
}

func formatStoolColor(p *string) string {
	if p == nil {
		return ""
	}
	switch *p {
	case "yellow":
		return "黄色"
	case "green":
		return "绿色"
	case "brown":
		return "棕色"
	case "abnormal":
		return "异常色"
	default:
		return *p
	}
}
