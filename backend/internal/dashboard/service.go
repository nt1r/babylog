// Package dashboard 提供基于本地时区的首页今日汇总 KPI（含健康观察与生长发育概览）、
// 距上次照护时长、跨夜睡眠自然日切分、多维多日趋势（喂养/睡眠/排泄/健康与周期洞察）及全天照护节律聚合服务。
package dashboard

import (
	"context"
	"math"
	"time"

	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

const (
	// DefaultTrendDays 为趋势接口未传天数参数时的默认回溯天数。
	DefaultTrendDays = 7
	// MinTrendDays 为趋势查询允许的最小回溯天数。
	MinTrendDays = 1
	// MaxTrendDays 为趋势查询允许的最大回溯天数。
	MaxTrendDays = 90
)

// daySlots 定义全天照护节律柱状图的 5 个有序中文时段标签（`[...]` 表示由编译器推导固定长度数组）。
var daySlots = [...]string{"清晨", "上午", "下午", "傍晚", "夜间"}

var weekdayLabels = [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}

// FeedingSummary 汇总今日喂养 KPI 与上次喂养时刻。
// 通过 Go 结构体嵌入（匿名字段）[records.FeedingDailySummary] 复用单一汇总结构：
// 序列化为 JSON 时其内部字段会自动扁平提升到顶层，不产生额外嵌套层级。
type FeedingSummary struct {
	records.FeedingDailySummary
	LastFeedingAt *string `json:"last_feeding_at"`
}

// SleepSummary 汇总今日睡眠 KPI（跨夜睡眠已按本地自然日切分）。
// 使用 Go 类型别名（`=`）直接等价复用 [records.SleepDailySummary]，零拷贝且无需显式类型转换。
type SleepSummary = records.SleepDailySummary

// HealthSummary 汇总健康观察所需的最近体温与今日用药信息。
type HealthSummary struct {
	LatestTempC        *float64 `json:"latest_temp_c"`
	LatestTempAt       *string  `json:"latest_temp_at"`
	TodayMedicineCount int      `json:"today_medicine_count"`
	LatestMedicineName *string  `json:"latest_medicine_name"`
	LatestMedicineAt   *string  `json:"latest_medicine_at"`
}

// GrowthSummary 汇总独立解析的最新体格测量值（含宝宝档案出生体格兜底标记）与累计出牙统计。
// 通过匿名嵌入 [records.GrowthHighlights] 复用统一字段与 JSON 标签，仅叠加看板专属的出生兜底标记。
type GrowthSummary struct {
	records.GrowthHighlights
	WeightIsBirth bool `json:"weight_is_birth"`
	HeightIsBirth bool `json:"height_is_birth"`
}

// BirthBaseline 承载来自宝宝档案的出生日期与可选出生体格值，供生长概览在尚无手动测量时兜底。
type BirthBaseline struct {
	BirthDate string
	WeightKg  *float64
	HeightCm  *float64
}

// CareSummary 汇总今日护理 KPI 与上次换尿布时刻。
// 通过内嵌 [records.CareDailySummary] 复用单一汇总结构并保持 JSON 顶层字段不变。
type CareSummary struct {
	records.CareDailySummary
	LastDiaperAt *string `json:"last_diaper_at"`
}

// SummaryResponse 表示 GET /api/babies/:babyId/dashboard/summary 的完整响应体。
type SummaryResponse struct {
	Date    string         `json:"date"`
	Feeding FeedingSummary `json:"feeding"`
	Sleep   SleepSummary   `json:"sleep"`
	Health  HealthSummary  `json:"health"`
	Growth  GrowthSummary  `json:"growth"`
	Care    CareSummary    `json:"care"`
}

// DailyTrendPoint 表示趋势图中的单日多维数据点（兼容既有基础字段并补充喂养、睡眠、护理与健康分项）。
type DailyTrendPoint struct {
	Date              string   `json:"date"`
	Label             string   `json:"label"`
	FeedingML         int      `json:"feeding_ml"`
	FormulaML         int      `json:"formula_ml"`
	FormulaCount      int      `json:"formula_count"`
	BottleBreastML    int      `json:"bottle_breast_ml"`
	BottleBreastCount int      `json:"bottle_breast_count"`
	DirectBreastMin   int      `json:"direct_breast_min"`
	DirectBreastCount int      `json:"direct_breast_count"`
	SolidCount        int      `json:"solid_count"`
	FeedingCount      int      `json:"feeding_count"`
	SleepHours        float64  `json:"sleep_hours"`
	NapHours          float64  `json:"nap_hours"`
	NightHours        float64  `json:"night_hours"`
	NapCount          int      `json:"nap_count"`
	PeeCount          int      `json:"pee_count"`
	PoopCount         int      `json:"poop_count"`
	BathCount         int      `json:"bath_count"`
	MaxTempC          *float64 `json:"max_temp_c"`
	MedicineCount     int      `json:"medicine_count"`
}

// PeriodActiveDays 统计趋势窗口内各品类存在有效记录的自然日天数，用于前端计算“有记录日均”。
type PeriodActiveDays struct {
	FeedingDays int `json:"feeding_days"`
	SleepDays   int `json:"sleep_days"`
	CareDays    int `json:"care_days"`
}

// BreastSideSummary 汇总趋势窗口内亲喂左/右/双侧的频次分布。
type BreastSideSummary struct {
	LeftCount  int `json:"left_count"`
	RightCount int `json:"right_count"`
	BothCount  int `json:"both_count"`
}

// SolidAcceptanceSummary 汇总趋势窗口内辅食接受度分布。
type SolidAcceptanceSummary struct {
	LikeCount    int `json:"like_count"`
	NeutralCount int `json:"neutral_count"`
	DislikeCount int `json:"dislike_count"`
}

// PeriodSleepSummary 汇总趋势窗口内的睡眠连续性指标（最长连续夜觉与白天小睡均长，单位分钟）。
type PeriodSleepSummary struct {
	LongestNightMin int `json:"longest_night_min"`
	AvgNapMin       int `json:"avg_nap_min"`
}

// PeriodStoolSummary 汇总趋势窗口内的排便总次数与需关注的性状/颜色次数。
type PeriodStoolSummary struct {
	TotalPoopCount     int `json:"total_poop_count"`
	WateryCount        int `json:"watery_count"`
	HardCount          int `json:"hard_count"`
	AbnormalColorCount int `json:"abnormal_color_count"`
}

// PeriodTrendSummary 汇总趋势窗口内无法仅凭单日合计反推的周期级洞察指标。
type PeriodTrendSummary struct {
	ActiveDays      PeriodActiveDays       `json:"active_days"`
	BreastSide      BreastSideSummary      `json:"breast_side"`
	SolidAcceptance SolidAcceptanceSummary `json:"solid_acceptance"`
	Sleep           PeriodSleepSummary     `json:"sleep"`
	Stool           PeriodStoolSummary     `json:"stool"`
}

// SlotDistributionPoint 表示全天照护节律柱状图的单个时段。
type SlotDistributionPoint struct {
	Slot  string `json:"slot"`
	Count int    `json:"count"`
}

// TrendsResponse 表示 GET /api/babies/:babyId/dashboard/trends 的完整响应体。
type TrendsResponse struct {
	Daily         []DailyTrendPoint       `json:"daily"`
	Slots         []SlotDistributionPoint `json:"slots"`
	PeriodSummary PeriodTrendSummary      `json:"period_summary"`
}

// Service 负责通过 [records.Store] 读取时间窗口快照与最近标记，并聚合首页看板数据。
type Service struct {
	store *records.Store
	now   func() time.Time
}

// NewService 创建看板聚合服务。
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

// daySlotLabel 返回给定时刻在指定时区下对应的照护时段标签：
// 清晨(05:00-08:59)、上午(09:00-11:59)、下午(12:00-17:59)、傍晚(18:00-20:59)、夜间(21:00-04:59)。
func daySlotLabel(t time.Time, loc *time.Location) string {
	hour := t.In(loc).Hour()
	switch {
	case hour >= 5 && hour < 9:
		return "清晨"
	case hour >= 9 && hour < 12:
		return "上午"
	case hour >= 12 && hour < 18:
		return "下午"
	case hour >= 18 && hour < 21:
		return "傍晚"
	default:
		return "夜间"
	}
}

// GetSummary 按指定本地时区聚合今日 5 维概览（喂养、睡眠、健康观察、生长发育与护理）及距上次照护时间戳。
// 可选 [BirthBaseline] 来自宝宝档案（出生日期及出生体重/身高），在尚无手动测量记录时独立兜底填充。
func (s *Service) GetSummary(ctx context.Context, babyID int64, loc *time.Location, baseline *BirthBaseline) (*SummaryResponse, error) {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	now := s.now()
	dayStart, dayEnd := timeutil.LocalDayBounds(now, loc)
	todayKey := dayStart.Format(timeutil.DateLayout)

	snap, err := s.store.ReadWindow(ctx, babyID, records.WindowQuery{
		Start: dayStart,
		End:   dayEnd,
		Categories: []records.WindowCategory{
			records.WindowCategoryFeeding,
			records.WindowCategorySleep,
			records.WindowCategoryCare,
			records.WindowCategoryHealth,
		},
	})
	if err != nil {
		return nil, err
	}
	highlights, err := s.store.ReadLatestHighlights(ctx, babyID)
	if err != nil {
		return nil, err
	}

	growth := GrowthSummary{
		GrowthHighlights: highlights.Growth,
	}
	// 体重与身高各自独立回退出生基准（头围无出生基准）；
	// 兜底写入的 RecordedAt 为宝宝档案日期 YYYY-MM-DD（区别于手动测量的 UTC RFC3339），前端凭 WeightIsBirth/HeightIsBirth 区分渲染，
	// 且拷贝标量后再取地址，避免与调用方 baseline 指针共享内存。
	if baseline != nil {
		if growth.LatestWeightKg == nil && baseline.WeightKg != nil {
			v := *baseline.WeightKg
			growth.LatestWeightKg = &v
			growth.WeightIsBirth = true
			if baseline.BirthDate != "" {
				bd := baseline.BirthDate
				growth.WeightRecordedAt = &bd
			}
		}
		if growth.LatestHeightCm == nil && baseline.HeightCm != nil {
			v := *baseline.HeightCm
			growth.LatestHeightCm = &v
			growth.HeightIsBirth = true
			if baseline.BirthDate != "" {
				bd := baseline.BirthDate
				growth.HeightRecordedAt = &bd
			}
		}
	}

	todaySum := snap.SummarizeByLocalDay(loc)[todayKey]
	med := snap.SummarizeMedicine()
	resp := &SummaryResponse{
		Date: todayKey,
		Feeding: FeedingSummary{
			FeedingDailySummary: todaySum.Feeding,
			LastFeedingAt:       highlights.LastFeedingAt,
		},
		Sleep: todaySum.Sleep,
		Health: HealthSummary{
			LatestTempC:        highlights.LatestTempC,
			LatestTempAt:       highlights.LatestTempAt,
			TodayMedicineCount: med.Count,
			LatestMedicineName: med.LatestName,
			LatestMedicineAt:   med.LatestAt,
		},
		Growth: growth,
		Care: CareSummary{
			CareDailySummary: todaySum.Care,
			LastDiaperAt:     highlights.LastDiaperAt,
		},
	}

	return resp, nil
}

// GetTrends 按本地时区返回连续 days 天的多维每日趋势（空日补 0）、5 时段照护频次分布及周期洞察摘要。
func (s *Service) GetTrends(ctx context.Context, babyID int64, days int, loc *time.Location) (*TrendsResponse, error) {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	if days < MinTrendDays {
		days = DefaultTrendDays
	}
	if days > MaxTrendDays {
		days = MaxTrendDays
	}

	now := s.now()
	todayStart, todayEnd := timeutil.LocalDayBounds(now, loc)
	windowStart := todayStart.AddDate(0, 0, -(days - 1))

	snap, err := s.store.ReadWindow(ctx, babyID, records.WindowQuery{
		Start: windowStart,
		End:   todayEnd,
	})
	if err != nil {
		return nil, err
	}

	keys := timeutil.RecentLocalDateKeys(now, days, loc)
	// 复用 records 统一按日聚合，保证首页看板、多日趋势与 Excel 导出统计口径一致。
	byDay := snap.SummarizeByLocalDay(loc)
	slotCounts := make(map[string]int, len(daySlots))
	var periodSummary PeriodTrendSummary
	var napDurationSum, napSessionCount int

	// 1. 喂养周期洞察（亲喂侧别、辅食接受度）与时段计数
	for _, r := range snap.Feedings {
		ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt)
		if parseErr != nil {
			continue
		}
		slotCounts[daySlotLabel(ts, loc)]++

		switch r.Subtype {
		case records.FeedingSubtypeBreast:
			if r.FeedingMode == nil || *r.FeedingMode != records.FeedingModeBottle {
				if r.BreastSide != nil {
					switch *r.BreastSide {
					case records.BreastSideLeft:
						periodSummary.BreastSide.LeftCount++
					case records.BreastSideRight:
						periodSummary.BreastSide.RightCount++
					case records.BreastSideBoth:
						periodSummary.BreastSide.BothCount++
					}
				}
			}
		case records.FeedingSubtypeSolid:
			if r.Acceptance != nil {
				switch *r.Acceptance {
				case records.AcceptanceLike:
					periodSummary.SolidAcceptance.LikeCount++
				case records.AcceptanceNeutral:
					periodSummary.SolidAcceptance.NeutralCount++
				case records.AcceptanceDislike:
					periodSummary.SolidAcceptance.DislikeCount++
				}
			}
		}
	}

	// 2. 睡眠入睡时段计数与连续性指标（跨夜睡眠时长切分已由 WindowSnapshot.SummarizeByLocalDay 统一完成）
	for _, r := range snap.Sleeps {
		st, parseErr := timeutil.ParseTimestamp(r.StartedAt)
		if parseErr != nil {
			continue
		}
		// 仅当入睡时刻本身落在当前统计窗口 [windowStart, todayEnd) 内时才计入照护节律与周期睡眠连续性，
		// 避免从窗口前一天跨夜延续进来的睡眠被重复归入本窗口统计。
		if !st.Before(windowStart) && st.Before(todayEnd) {
			slotCounts[daySlotLabel(st, loc)]++
			if r.Subtype == records.SleepSubtypeNight {
				if r.DurationMin > periodSummary.Sleep.LongestNightMin {
					periodSummary.Sleep.LongestNightMin = r.DurationMin
				}
			} else if r.DurationMin > 0 {
				napDurationSum += r.DurationMin
				napSessionCount++
			}
		}
	}
	if napSessionCount > 0 {
		periodSummary.Sleep.AvgNapMin = int(math.Round(float64(napDurationSum) / float64(napSessionCount)))
	}

	// 3. 便便性状/颜色观察统计与护理/健康/生长全天照护节律时段计数
	for _, r := range snap.Cares {
		ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt)
		if parseErr != nil {
			continue
		}
		slotCounts[daySlotLabel(ts, loc)]++

		if r.Subtype == records.CareSubtypeDiaper && r.DiaperKind != nil && (*r.DiaperKind == records.DiaperKindPoop || *r.DiaperKind == records.DiaperKindBoth) {
			periodSummary.Stool.TotalPoopCount++
			if r.StoolConsistency != nil {
				switch *r.StoolConsistency {
				case records.StoolConsistencyWatery:
					periodSummary.Stool.WateryCount++
				case records.StoolConsistencyHard:
					periodSummary.Stool.HardCount++
				}
			}
			if r.StoolColor != nil && *r.StoolColor == records.StoolColorAbnormal {
				periodSummary.Stool.AbnormalColorCount++
			}
		}
	}
	for _, r := range snap.Healths {
		if ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt); parseErr == nil {
			slotCounts[daySlotLabel(ts, loc)]++
		}
	}
	for _, r := range snap.Growths {
		if ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt); parseErr == nil {
			slotCounts[daySlotLabel(ts, loc)]++
		}
	}

	// 4. 按升序日期键组装连续每日数据点（无记录日期自动补 0）：
	// 近 7 天以内横轴用“周一~周日”，超过 7 天用“月/日”（Go 参考格式 "1/2" 表示不补零的月/日）。
	daily := make([]DailyTrendPoint, 0, len(keys))
	for _, key := range keys {
		dayTime, _ := time.ParseInLocation(timeutil.DateLayout, key, loc)
		label := dayTime.Format("1/2")
		if days <= 7 {
			label = weekdayLabels[dayTime.Weekday()]
		}
		daySum := byDay[key]
		feedDay := daySum.Feeding
		sleepDay := daySum.Sleep
		careDay := daySum.Care
		healthDay := daySum.Health

		point := DailyTrendPoint{
			Date:              key,
			Label:             label,
			FeedingML:         feedDay.TotalML,
			FormulaML:         feedDay.FormulaML,
			FormulaCount:      feedDay.FormulaCount,
			BottleBreastML:    feedDay.BottleBreastML,
			BottleBreastCount: feedDay.BottleBreastCount,
			DirectBreastMin:   feedDay.DirectBreastMin,
			DirectBreastCount: feedDay.DirectBreastCount,
			SolidCount:        feedDay.SolidCount,
			FeedingCount:      feedDay.TotalCount,
			SleepHours:        sleepDay.TotalHours(),
			NapHours:          sleepDay.NapHours(),
			NightHours:        sleepDay.NightHours(),
			NapCount:          sleepDay.NapCount,
			PeeCount:          careDay.PeeCount,
			PoopCount:         careDay.PoopCount,
			BathCount:         careDay.BathCount,
			MaxTempC:          healthDay.MaxTempC,
			MedicineCount:     healthDay.MedicineCount,
		}

		if point.FeedingCount > 0 {
			periodSummary.ActiveDays.FeedingDays++
		}
		if sleepDay.TotalMin > 0 {
			periodSummary.ActiveDays.SleepDays++
		}
		if point.PeeCount > 0 || point.PoopCount > 0 || point.BathCount > 0 {
			periodSummary.ActiveDays.CareDays++
		}

		daily = append(daily, point)
	}

	slots := make([]SlotDistributionPoint, 0, len(daySlots))
	for _, slot := range daySlots {
		slots = append(slots, SlotDistributionPoint{
			Slot:  slot,
			Count: slotCounts[slot],
		})
	}

	return &TrendsResponse{
		Daily:         daily,
		Slots:         slots,
		PeriodSummary: periodSummary,
	}, nil
}
