package records

import (
	"math"
	"slices"
	"sort"
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func roundHours1(mins int) float64 {
	return math.Round(float64(mins)/60.0*10) / 10
}

// NapMin 返回当日白天小睡总分钟数（以 TotalMin 扣减 NightMin 并下限钳位为 0）。
func (s SleepDailySummary) NapMin() int {
	return max(s.TotalMin-s.NightMin, 0)
}

// TotalHours 返回当日总睡眠时长（小时，保留 1 位小数），供多日趋势与 Excel 导出共用统一换算口径。
func (s SleepDailySummary) TotalHours() float64 {
	return roundHours1(s.TotalMin)
}

// NightHours 返回当日夜间睡眠时长（小时，保留 1 位小数）。
func (s SleepDailySummary) NightHours() float64 {
	return roundHours1(s.NightMin)
}

// NapHours 返回当日白天小睡时长（小时，保留 1 位小数）。
func (s SleepDailySummary) NapHours() float64 {
	return roundHours1(s.NapMin())
}

// accumulateFeedingSummary 将单条喂养记录累加到汇总结构中，
// 供列表页按日小计与时间窗口按日汇总共同复用，确保统计口径单一事实来源。
func accumulateFeedingSummary(sum *FeedingDailySummary, r FeedingRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case FeedingSubtypeFormula:
		sum.FormulaCount++
		if r.AmountML != nil {
			sum.FormulaML += *r.AmountML
			sum.TotalML += *r.AmountML
		}
	case FeedingSubtypeBreast:
		if r.FeedingMode != nil && *r.FeedingMode == FeedingModeBottle {
			sum.BottleBreastCount++
			if r.AmountML != nil {
				sum.BottleBreastML += *r.AmountML
				sum.TotalML += *r.AmountML
			}
		} else {
			sum.DirectBreastCount++
			if r.DurationMin != nil {
				sum.DirectBreastMin += *r.DurationMin
			}
		}
	case FeedingSubtypeSolid:
		sum.SolidCount++
	}
}

// accumulateCareSummary 将单条护理记录累加到汇总结构中，
// 供列表页按日小计与时间窗口按日汇总共同复用。
func accumulateCareSummary(sum *CareDailySummary, r CareRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case CareSubtypeDiaper:
		if r.DiaperKind != nil {
			switch *r.DiaperKind {
			case DiaperKindPee:
				sum.PeeCount++
			case DiaperKindPoop:
				sum.PoopCount++
			case DiaperKindBoth:
				sum.PeeCount++
				sum.PoopCount++
			}
		}
	case CareSubtypeBath:
		sum.BathCount++
	case CareSubtypeOther:
		sum.OtherCount++
	}
}

// accumulateSleepSummary 将单条睡眠记录落入某一本地自然日的有效分钟数累加到汇总结构中。
func accumulateSleepSummary(sum *SleepDailySummary, r SleepRecord, mins int) {
	if mins <= 0 {
		return
	}
	sum.TotalMin += mins
	if r.Subtype == SleepSubtypeNight {
		sum.NightMin += mins
	} else {
		sum.NapCount++
	}
}

// accumulateSleepByLocalDay 将睡眠记录切片按本地自然日边界切分并累加为每日睡眠小计；
// allowedKeys 非空时仅保留指定自然日键，避免列表反查出的跨夜睡眠将非当前页相邻日混入结果。
func accumulateSleepByLocalDay(sleeps []SleepRecord, loc *time.Location, allowedKeys map[string]struct{}) map[string]SleepDailySummary {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	summaries := make(map[string]SleepDailySummary, len(allowedKeys))
	for _, r := range sleeps {
		st, err1 := timeutil.ParseTimestamp(r.StartedAt)
		et, err2 := timeutil.ParseTimestamp(r.EndedAt)
		if err1 != nil || err2 != nil {
			continue
		}
		parts := timeutil.SplitIntervalMinutesByLocalDay(st, et, loc)
		for key, mins := range parts {
			if allowedKeys != nil {
				if _, wanted := allowedKeys[key]; !wanted {
					continue
				}
			}
			sum := summaries[key]
			accumulateSleepSummary(&sum, r, mins)
			summaries[key] = sum
		}
	}
	return summaries
}

// accumulateHealthSummary 将单条健康与生长记录累加到列表每日小计中；
// 调用方按 recorded_at DESC, id DESC 顺序遍历时，首条非空体温记录自动成为当日最近体温。
func accumulateHealthSummary(sum *HealthDailySummary, r HealthRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case HealthSubtypeTemperature:
		if sum.LatestTempC == nil && r.TemperatureC != nil {
			// 复制一份标量值再取地址，避免小计结构体与原始记录共享同一指针。
			v := *r.TemperatureC
			sum.LatestTempC = &v
		}
	case HealthSubtypeMedicine:
		sum.MedicineCount++
	}
}

func isHealthAscending(items []HealthRecord) bool {
	for i := 1; i < len(items); i++ {
		prev, cur := items[i-1], items[i]
		if cur.RecordedAt < prev.RecordedAt || (cur.RecordedAt == prev.RecordedAt && cur.ID < prev.ID) {
			return false
		}
	}
	return true
}

// SummarizeByLocalDay 按指定本地时区将窗口快照内的五类照护记录统一聚合为本地自然日小计，
// 供首页看板今日 KPI、多日趋势与 Excel 导出共用单一聚合口径；
// 生长测量与出牙说明利用 UTC RFC3339 字典序等价时刻顺序的特性，内置按 (RecordedAt, ID) 升序决胜，不依赖调用方提前排序。
func (s *WindowSnapshot) SummarizeByLocalDay(loc *time.Location) map[string]DailyWindowSummary {
	result := make(map[string]DailyWindowSummary)
	if s == nil {
		return result
	}
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}

	for _, r := range s.Feedings {
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		day := result[key]
		accumulateFeedingSummary(&day.Feeding, r)
		result[key] = day
	}

	for key, sleepDay := range accumulateSleepByLocalDay(s.Sleeps, loc, nil) {
		day := result[key]
		day.Sleep = sleepDay
		result[key] = day
	}

	for _, r := range s.Cares {
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		day := result[key]
		accumulateCareSummary(&day.Care, r)
		result[key] = day
	}

	for _, r := range s.Healths {
		if r.Subtype != HealthSubtypeTemperature && r.Subtype != HealthSubtypeMedicine {
			continue
		}
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		day := result[key]
		switch r.Subtype {
		case HealthSubtypeTemperature:
			if r.TemperatureC != nil && (day.Health.MaxTempC == nil || *r.TemperatureC > *day.Health.MaxTempC) {
				v := *r.TemperatureC
				day.Health.MaxTempC = &v
			}
		case HealthSubtypeMedicine:
			day.Health.MedicineCount++
		}
		result[key] = day
	}

	growths := s.Growths
	if len(growths) > 1 && !isHealthAscending(growths) {
		growths = slices.Clone(growths)
		sort.Slice(growths, func(i, j int) bool {
			if growths[i].RecordedAt != growths[j].RecordedAt {
				return growths[i].RecordedAt < growths[j].RecordedAt
			}
			return growths[i].ID < growths[j].ID
		})
	}
	for _, r := range growths {
		if r.Subtype != HealthSubtypeGrowth && r.Subtype != HealthSubtypeTeeth {
			continue
		}
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		day := result[key]
		if r.Subtype == HealthSubtypeGrowth {
			if r.WeightKg != nil {
				v := *r.WeightKg
				day.Growth.WeightKg = &v
			}
			if r.HeightCm != nil {
				v := *r.HeightCm
				day.Growth.HeightCm = &v
			}
			if r.HeadCm != nil {
				v := *r.HeadCm
				day.Growth.HeadCm = &v
			}
		} else if r.Subtype == HealthSubtypeTeeth && r.ToothNote != nil && *r.ToothNote != "" {
			day.Growth.Teeth = append(day.Growth.Teeth, *r.ToothNote)
		}
		result[key] = day
	}

	return result
}

// SummarizeMedicine 从窗口快照的临床健康记录中统计用药次数，并按 RecordedAt 与 ID 确定性选取最新一条用药记录。
// 利用 UTC RFC3339 字典序与时刻顺序等价的特性比较先后，且当最新用药未填药名时显式置 nil 避免残留旧值。
func (s *WindowSnapshot) SummarizeMedicine() MedicineSummary {
	var sum MedicineSummary
	if s == nil {
		return sum
	}
	var latestID int64
	var latestAt string
	for _, r := range s.Healths {
		if r.Subtype != HealthSubtypeMedicine {
			continue
		}
		sum.Count++
		if sum.Count == 1 || r.RecordedAt > latestAt || (r.RecordedAt == latestAt && r.ID > latestID) {
			latestID = r.ID
			latestAt = r.RecordedAt
			ts := r.RecordedAt
			sum.LatestAt = &ts
			if r.MedicineName != nil {
				name := *r.MedicineName
				sum.LatestName = &name
			} else {
				sum.LatestName = nil
			}
		}
	}
	return sum
}
