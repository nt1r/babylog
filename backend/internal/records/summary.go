package records

import (
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// AccumulateFeedingSummary 将单条喂养记录累加到汇总结构中，
// 供列表页按日小计、首页看板今日 KPI、多日趋势与数据导出共同复用，确保统计口径单一事实来源。
func AccumulateFeedingSummary(sum *FeedingDailySummary, r FeedingRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case FeedingSubtypeFormula:
		sum.FormulaCount++
		if r.AmountML != nil {
			sum.FormulaML += *r.AmountML
			sum.TotalML += *r.AmountML
		}
	case FeedingSubtypeBreast:
		if r.FeedingMode != nil && *r.FeedingMode == "bottle" {
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

// AccumulateCareSummary 将单条护理记录累加到汇总结构中，
// 供列表页按日小计、首页看板今日 KPI、多日趋势与数据导出共同复用。
func AccumulateCareSummary(sum *CareDailySummary, r CareRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case CareSubtypeDiaper:
		if r.DiaperKind != nil {
			switch *r.DiaperKind {
			case "pee":
				sum.PeeCount++
			case "poop":
				sum.PoopCount++
			case "both":
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

// SummarizeSleepByLocalDay 按指定本地时区将一组睡眠记录跨夜切分并汇总为每日小计，
// 供首页看板今日 KPI、多日趋势与数据导出复用，并与列表页共享同一跨夜切分及累加口径。
func SummarizeSleepByLocalDay(sleeps []SleepRecord, loc *time.Location) map[string]SleepDailySummary {
	return accumulateSleepByLocalDay(sleeps, loc, nil)
}

// SummarizeFeedingByLocalDay 按指定本地时区将一组喂养记录汇总为每日小计（含配方奶与瓶喂母乳分项），
// 供多日趋势与 Excel 数据导出共享单一聚合口径。
func SummarizeFeedingByLocalDay(feedings []FeedingRecord, loc *time.Location) map[string]FeedingDailySummary {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	result := make(map[string]FeedingDailySummary)
	for _, r := range feedings {
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		sum := result[key]
		AccumulateFeedingSummary(&sum, r)
		result[key] = sum
	}
	return result
}

// SummarizeCareByLocalDay 按指定本地时区将一组护理记录汇总为每日小计，
// 供多日趋势与 Excel 数据导出共享单一聚合口径。
func SummarizeCareByLocalDay(cares []CareRecord, loc *time.Location) map[string]CareDailySummary {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	result := make(map[string]CareDailySummary)
	for _, r := range cares {
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		sum := result[key]
		AccumulateCareSummary(&sum, r)
		result[key] = sum
	}
	return result
}

// SummarizeClinicalHealthByLocalDay 按指定本地时区汇总每日最高体温与用药次数（仅统计 temperature 与 medicine），
// 供多日趋势与 Excel 数据导出共享单一聚合口径。
func SummarizeClinicalHealthByLocalDay(healths []HealthRecord, loc *time.Location) map[string]ClinicalHealthDayStats {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}
	result := make(map[string]ClinicalHealthDayStats)
	for _, r := range healths {
		if r.Subtype != HealthSubtypeTemperature && r.Subtype != HealthSubtypeMedicine {
			continue
		}
		ts, err := timeutil.ParseTimestamp(r.RecordedAt)
		if err != nil {
			continue
		}
		key := timeutil.LocalDateKey(ts, loc)
		stats := result[key]
		switch r.Subtype {
		case HealthSubtypeTemperature:
			if r.TemperatureC != nil && (stats.MaxTempC == nil || *r.TemperatureC > *stats.MaxTempC) {
				v := *r.TemperatureC
				stats.MaxTempC = &v
			}
		case HealthSubtypeMedicine:
			stats.MedicineCount++
		}
		result[key] = stats
	}
	return result
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

// SummarizeMedicine 从健康记录切片中统计用药次数，并按 RecordedAt 与 ID 确定性选取最新一条用药记录。
// 利用 UTC RFC3339 字典序与时刻顺序等价的特性比较先后，且当最新用药未填药名时显式置 nil 避免残留旧值。
func SummarizeMedicine(healths []HealthRecord) MedicineSummary {
	var sum MedicineSummary
	var latestID int64
	var latestAt string
	for _, r := range healths {
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
