package records

// AccumulateFeedingSummary 将单条喂养记录累加到汇总结构中，
// 供列表页按日小计与首页看板今日 KPI 共同复用，确保两处统计口径单一事实来源。
func AccumulateFeedingSummary(sum *FeedingDailySummary, r FeedingRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case FeedingSubtypeFormula:
		if r.AmountML != nil {
			sum.TotalML += *r.AmountML
		}
	case FeedingSubtypeBreast:
		if r.FeedingMode != nil && *r.FeedingMode == "bottle" {
			if r.AmountML != nil {
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
// 供列表页按日小计与首页看板今日 KPI 共同复用。
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

// AccumulateSleepSummary 将单条睡眠记录落入某一本地自然日的有效分钟数累加到汇总结构中，
// 供睡眠列表页按日小计与首页看板今日 KPI 共同复用，确保跨夜切分后的统计口径单一。
func AccumulateSleepSummary(sum *SleepDailySummary, r SleepRecord, mins int) {
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

// AccumulateHealthSummary 将单条健康与生长记录累加到每日小计中；
// 调用方按 recorded_at DESC, id DESC 顺序遍历时，首条非空体温记录自动成为当日最近体温。
func AccumulateHealthSummary(sum *HealthDailySummary, r HealthRecord) {
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
