// Package dashboard 提供基于本地时区的首页今日汇总 KPI、距上次照护时长、
// 跨夜睡眠自然日切分、近 N 日趋势以及全天照护节律聚合服务。
package dashboard

import (
	"context"
	"math"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// FeedingSummary 汇总今日喂养 KPI 与上次喂养时刻。
type FeedingSummary struct {
	TotalML           int     `json:"total_ml"`
	FormulaCount      int     `json:"formula_count"`
	BottleBreastCount int     `json:"bottle_breast_count"`
	DirectBreastCount int     `json:"direct_breast_count"`
	DirectBreastMin   int     `json:"direct_breast_min"`
	SolidCount        int     `json:"solid_count"`
	TotalCount        int     `json:"total_count"`
	LastFeedingAt     *string `json:"last_feeding_at"`
}

// SleepSummary 汇总今日睡眠 KPI（跨夜睡眠已按本地自然日切分）。
type SleepSummary struct {
	TotalMin   int `json:"total_min"`
	NapCount   int `json:"nap_count"`
	NapMin     int `json:"nap_min"`
	NightCount int `json:"night_count"`
	NightMin   int `json:"night_min"`
}

// HealthSummary 汇总最近一次体温记录。
type HealthSummary struct {
	LatestTempC  *float64 `json:"latest_temp_c"`
	LatestTempAt *string  `json:"latest_temp_at"`
}

// CareSummary 汇总今日护理 KPI 与上次换尿布时刻。
type CareSummary struct {
	TotalCount   int     `json:"total_count"`
	DiaperCount  int     `json:"diaper_count"`
	PeeCount     int     `json:"pee_count"`
	PoopCount    int     `json:"poop_count"`
	BathCount    int     `json:"bath_count"`
	OtherCount   int     `json:"other_count"`
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

// Service 负责查询并聚合首页看板数据。
type Service struct {
	db  *gorm.DB
	now func() time.Time
}

// NewService 创建看板聚合服务。
func NewService(db *gorm.DB) *Service {
	return &Service{
		db:  db,
		now: time.Now,
	}
}

// WithClock 替换内部时钟函数（用于确定性测试）。
func (s *Service) WithClock(fn func() time.Time) *Service {
	if fn != nil {
		s.now = fn
	}
	return s
}

// GetSummary 按指定本地时区聚合今日 4 项 KPI 与距上次照护时间戳。
func (s *Service) GetSummary(ctx context.Context, babyID int64, loc *time.Location) (*SummaryResponse, error) {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	now := s.now()
	dayStart, dayEnd := timeutil.LocalDayBounds(now, loc)
	startUTC := timeutil.FormatUTC(dayStart)
	endUTC := timeutil.FormatUTC(dayEnd)

	resp := &SummaryResponse{
		Date:     dayStart.Format(timeutil.DateLayout),
		Timezone: loc.String(),
	}

	// 1. 今日喂养汇总（复用 records 包聚合函数确保口径一致）+ 最近一次喂养时间
	var todayFeedings []records.FeedingRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&todayFeedings).Error; err != nil {
		return nil, err
	}
	var feedAgg records.FeedingDailySummary
	for _, r := range todayFeedings {
		records.AccumulateFeedingSummary(&feedAgg, r)
	}
	resp.Feeding = FeedingSummary{
		TotalML:           feedAgg.TotalML,
		FormulaCount:      feedAgg.FormulaCount,
		BottleBreastCount: feedAgg.BottleBreastCount,
		DirectBreastCount: feedAgg.DirectBreastCount,
		DirectBreastMin:   feedAgg.DirectBreastMin,
		SolidCount:        feedAgg.SolidCount,
		TotalCount:        feedAgg.TotalCount,
	}
	var latestFeeding records.FeedingRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ?", babyID).
		Order("recorded_at DESC, id DESC").
		Limit(1).
		Find(&latestFeeding).Error; err != nil {
		return nil, err
	}
	if latestFeeding.ID > 0 {
		ts := latestFeeding.RecordedAt
		resp.Feeding.LastFeedingAt = &ts
	}

	// 2. 今日睡眠汇总（与今日 [dayStart, dayEnd) 有交集的所有睡眠均按边界精确切分）
	var overlapSleeps []records.SleepRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND ended_at > ? AND started_at < ?", babyID, startUTC, endUTC).
		Find(&overlapSleeps).Error; err != nil {
		return nil, err
	}
	for _, r := range overlapSleeps {
		st, err1 := timeutil.ParseTimestamp(r.StartedAt)
		et, err2 := timeutil.ParseTimestamp(r.EndedAt)
		if err1 != nil || err2 != nil {
			continue
		}
		mins := timeutil.OverlapMinutes(st, et, dayStart, dayEnd)
		if mins <= 0 {
			continue
		}
		resp.Sleep.TotalMin += mins
		if r.Subtype == "night" {
			resp.Sleep.NightCount++
			resp.Sleep.NightMin += mins
		} else {
			resp.Sleep.NapCount++
			resp.Sleep.NapMin += mins
		}
	}

	// 3. 最近一次体温记录
	var latestTemp records.HealthRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype = ?", babyID, "temperature").
		Order("recorded_at DESC, id DESC").
		Limit(1).
		Find(&latestTemp).Error; err != nil {
		return nil, err
	}
	if latestTemp.ID > 0 && latestTemp.TemperatureC != nil {
		v := *latestTemp.TemperatureC
		ts := latestTemp.RecordedAt
		resp.Health.LatestTempC = &v
		resp.Health.LatestTempAt = &ts
	}

	// 4. 今日护理汇总（复用 records 包聚合函数）+ 最近一次换尿布时间
	var todayCares []records.CareRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&todayCares).Error; err != nil {
		return nil, err
	}
	var careAgg records.CareDailySummary
	for _, r := range todayCares {
		records.AccumulateCareSummary(&careAgg, r)
	}
	resp.Care = CareSummary{
		TotalCount:  careAgg.TotalCount,
		DiaperCount: careAgg.DiaperCount,
		PeeCount:    careAgg.PeeCount,
		PoopCount:   careAgg.PoopCount,
		BathCount:   careAgg.BathCount,
		OtherCount:  careAgg.OtherCount,
	}
	var latestDiaper records.CareRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype = ?", babyID, "diaper").
		Order("recorded_at DESC, id DESC").
		Limit(1).
		Find(&latestDiaper).Error; err != nil {
		return nil, err
	}
	if latestDiaper.ID > 0 {
		ts := latestDiaper.RecordedAt
		resp.Care.LastDiaperAt = &ts
	}

	return resp, nil
}

var weekdayLabels = [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}

// GetTrends 按本地时区返回连续 days 天的每日奶量/睡眠趋势（空日补 0）及 5 时段照护频次分布。
func (s *Service) GetTrends(ctx context.Context, babyID int64, days int, loc *time.Location) (*TrendsResponse, error) {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}

	now := s.now()
	todayStart, todayEnd := timeutil.LocalDayBounds(now, loc)
	windowStart := todayStart.AddDate(0, 0, -(days - 1))
	startUTC := timeutil.FormatUTC(windowStart)
	endUTC := timeutil.FormatUTC(todayEnd)

	keys := timeutil.RecentLocalDateKeys(now, days, loc)
	feedingByDay := make(map[string]*records.FeedingDailySummary, days)
	sleepMinByDay := make(map[string]int, days)
	slotCounts := make(map[string]int, len(timeutil.DaySlots))

	// 1. 喂养趋势（复用共享聚合函数确保奶量与亲喂口径一致）与时段计数
	var feedings []records.FeedingRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&feedings).Error; err != nil {
		return nil, err
	}
	for _, r := range feedings {
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		agg := feedingByDay[key]
		if agg == nil {
			agg = &records.FeedingDailySummary{}
			feedingByDay[key] = agg
		}
		records.AccumulateFeedingSummary(agg, r)
		slotCounts[timeutil.DaySlotLabel(ts, loc)]++
	}

	// 2. 睡眠趋势（跨夜按自然日切分）与入睡时段计数
	var sleeps []records.SleepRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND ended_at > ? AND started_at < ?", babyID, startUTC, endUTC).
		Find(&sleeps).Error; err != nil {
		return nil, err
	}
	for _, r := range sleeps {
		st, err1 := timeutil.ParseTimestamp(r.StartedAt)
		et, err2 := timeutil.ParseTimestamp(r.EndedAt)
		if err1 != nil || err2 != nil {
			continue
		}
		parts := timeutil.SplitIntervalMinutesByLocalDay(st, et, loc)
		for k, mins := range parts {
			sleepMinByDay[k] += mins
		}
		if !st.Before(windowStart) && st.Before(todayEnd) {
			slotCounts[timeutil.DaySlotLabel(st, loc)]++
		}
	}

	// 3. 护理与健康记录计入全天照护节律时段分布
	var cares []records.CareRecord
	if err := s.db.WithContext(ctx).
		Select("recorded_at").
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&cares).Error; err != nil {
		return nil, err
	}
	for _, r := range cares {
		if ts, err := timeutil.ParseTimestamp(r.RecordedAt); err == nil {
			slotCounts[timeutil.DaySlotLabel(ts, loc)]++
		}
	}

	var healths []records.HealthRecord
	if err := s.db.WithContext(ctx).
		Select("recorded_at").
		Where("baby_id = ? AND recorded_at >= ? AND recorded_at < ?", babyID, startUTC, endUTC).
		Find(&healths).Error; err != nil {
		return nil, err
	}
	for _, r := range healths {
		if ts, err := timeutil.ParseTimestamp(r.RecordedAt); err == nil {
			slotCounts[timeutil.DaySlotLabel(ts, loc)]++
		}
	}

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

	slots := make([]SlotDistributionPoint, 0, len(timeutil.DaySlots))
	for _, slot := range timeutil.DaySlots {
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
