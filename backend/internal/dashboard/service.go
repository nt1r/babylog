// Package dashboard 提供基于本地时区的首页今日汇总 KPI、距上次照护时长、
// 跨夜睡眠自然日切分、近 N 日趋势以及全天照护节律聚合服务。
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

// HealthSummary 汇总最近一次体温记录。
type HealthSummary struct {
	LatestTempC  *float64 `json:"latest_temp_c"`
	LatestTempAt *string  `json:"latest_temp_at"`
}

// CareSummary 汇总今日护理 KPI 与上次换尿布时刻。
// 通过内嵌 records.CareDailySummary 复用单一汇总结构并保持 JSON 顶层字段不变。
type CareSummary struct {
	records.CareDailySummary
	LastDiaperAt *string `json:"last_diaper_at"`
}

// SummaryResponse 表示 GET /api/dashboard/summary 的完整响应体。
type SummaryResponse struct {
	Date     string         `json:"date"`
	Timezone string         `json:"timezone"`
	Feeding  FeedingSummary `json:"feeding"`
	Sleep    SleepSummary   `json:"sleep"`
	Health   HealthSummary  `json:"health"`
	Care     CareSummary    `json:"care"`
}

// DailyTrendPoint 表示趋势图中的单日数据点。
type DailyTrendPoint struct {
	Date              string  `json:"date"`
	Label             string  `json:"label"`
	FeedingML         int     `json:"feeding_ml"`
	DirectBreastMin   int     `json:"direct_breast_min"`
	DirectBreastCount int     `json:"direct_breast_count"`
	SleepHours        float64 `json:"sleep_hours"`
}

// SlotDistributionPoint 表示全天照护节律柱状图的单个时段。
type SlotDistributionPoint struct {
	Slot  string `json:"slot"`
	Count int    `json:"count"`
}

// TrendsResponse 表示 GET /api/dashboard/trends 的完整响应体。
type TrendsResponse struct {
	Days     int                     `json:"days"`
	Timezone string                  `json:"timezone"`
	Daily    []DailyTrendPoint       `json:"daily"`
	Slots    []SlotDistributionPoint `json:"slots"`
}

// Service 负责通过 records.Store 读取时间窗口快照与最近标记，并聚合首页看板数据。
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

// GetSummary 按指定本地时区聚合今日 4 项 KPI 与距上次照护时间戳。
func (s *Service) GetSummary(ctx context.Context, babyID int64, loc *time.Location) (*SummaryResponse, error) {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	now := s.now()
	dayStart, dayEnd := timeutil.LocalDayBounds(now, loc)
	todayKey := dayStart.Format(timeutil.DateLayout)

	snap, err := s.store.ReadWindow(ctx, babyID, dayStart, dayEnd, records.WindowOptions{IncludeHealth: false})
	if err != nil {
		return nil, err
	}
	highlights, err := s.store.ReadLatestHighlights(ctx, babyID)
	if err != nil {
		return nil, err
	}

	resp := &SummaryResponse{
		Date:     todayKey,
		Timezone: loc.String(),
		Feeding: FeedingSummary{
			LastFeedingAt: highlights.LastFeedingAt,
		},
		Health: HealthSummary{
			LatestTempC:  highlights.LatestTempC,
			LatestTempAt: highlights.LatestTempAt,
		},
		Care: CareSummary{
			LastDiaperAt: highlights.LastDiaperAt,
		},
	}

	// 1. 今日喂养汇总（复用 records 共享累加器）
	for _, r := range snap.Feedings {
		records.AccumulateFeedingSummary(&resp.Feeding.FeedingDailySummary, r)
	}

	// 2. 今日睡眠汇总（与列表页及趋势图共用自然日切分与 records.AccumulateSleepSummary）
	for _, r := range snap.Sleeps {
		st, err1 := timeutil.ParseTimestamp(r.StartedAt)
		et, err2 := timeutil.ParseTimestamp(r.EndedAt)
		if err1 != nil || err2 != nil {
			continue
		}
		parts := timeutil.SplitIntervalMinutesByLocalDay(st, et, loc)
		records.AccumulateSleepSummary(&resp.Sleep, r, parts[todayKey])
	}

	// 3. 今日护理汇总（复用 records 共享累加器）
	for _, r := range snap.Cares {
		records.AccumulateCareSummary(&resp.Care.CareDailySummary, r)
	}

	return resp, nil
}

// GetTrends 按本地时区返回连续 days 天的每日奶量/睡眠趋势（空日补 0）及 5 时段照护频次分布。
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

	snap, err := s.store.ReadWindow(ctx, babyID, windowStart, todayEnd, records.WindowOptions{IncludeHealth: true})
	if err != nil {
		return nil, err
	}

	keys := timeutil.RecentLocalDateKeys(now, days, loc)
	feedingByDay := make(map[string]*records.FeedingDailySummary, days)
	sleepMinByDay := make(map[string]int, days)
	slotCounts := make(map[string]int, len(daySlots))

	// 1. 喂养趋势（复用共享累加器确保奶量与亲喂口径一致）与时段计数
	for _, r := range snap.Feedings {
		ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt)
		if parseErr != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		agg := feedingByDay[key]
		if agg == nil {
			agg = &records.FeedingDailySummary{}
			feedingByDay[key] = agg
		}
		records.AccumulateFeedingSummary(agg, r)
		slotCounts[daySlotLabel(ts, loc)]++
	}

	// 2. 睡眠趋势（跨夜按自然日切分）与入睡时段计数
	for _, r := range snap.Sleeps {
		st, err1 := timeutil.ParseTimestamp(r.StartedAt)
		et, err2 := timeutil.ParseTimestamp(r.EndedAt)
		if err1 != nil || err2 != nil {
			continue
		}
		parts := timeutil.SplitIntervalMinutesByLocalDay(st, et, loc)
		for k, mins := range parts {
			sleepMinByDay[k] += mins
		}
		// 仅当入睡时刻本身落在当前统计窗口 [windowStart, todayEnd) 内时才计入照护节律，
		// 避免从窗口前一天跨夜延续进来的睡眠被重复归入本窗口的入睡频次。
		if !st.Before(windowStart) && st.Before(todayEnd) {
			slotCounts[daySlotLabel(st, loc)]++
		}
	}

	// 3. 护理与健康记录计入全天照护节律时段分布
	for _, r := range snap.Cares {
		if ts, parseErr := timeutil.ParseTimestamp(r.RecordedAt); parseErr == nil {
			slotCounts[daySlotLabel(ts, loc)]++
		}
	}
	for _, r := range snap.Healths {
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
		hours := math.Round(float64(sleepMinByDay[key])/60.0*10) / 10
		var feedML, directBreastMin, directBreastCount int
		if agg := feedingByDay[key]; agg != nil {
			feedML = agg.TotalML
			directBreastMin = agg.DirectBreastMin
			directBreastCount = agg.DirectBreastCount
		}
		daily = append(daily, DailyTrendPoint{
			Date:              key,
			Label:             label,
			FeedingML:         feedML,
			DirectBreastMin:   directBreastMin,
			DirectBreastCount: directBreastCount,
			SleepHours:        hours,
		})
	}

	slots := make([]SlotDistributionPoint, 0, len(daySlots))
	for _, slot := range daySlots {
		slots = append(slots, SlotDistributionPoint{
			Slot:  slot,
			Count: slotCounts[slot],
		})
	}

	return &TrendsResponse{
		Days:     days,
		Timezone: loc.String(),
		Daily:    daily,
		Slots:    slots,
	}, nil
}
