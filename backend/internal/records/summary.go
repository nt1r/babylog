package records

// AccumulateFeedingSummary 将单条喂养记录累加到汇总结构中，
// 供列表页按日小计与首页看板今日 KPI 共同复用，确保两处统计口径单一事实来源。
func AccumulateFeedingSummary(sum *FeedingDailySummary, r FeedingRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case "formula":
		sum.FormulaCount++
		if r.AmountML != nil {
			sum.TotalML += *r.AmountML
		}
	case "breast":
		if r.FeedingMode != nil && *r.FeedingMode == "bottle" {
			sum.BottleBreastCount++
			if r.AmountML != nil {
				sum.TotalML += *r.AmountML
			}
		} else {
			sum.DirectBreastCount++
			if r.DurationMin != nil {
				sum.DirectBreastMin += *r.DurationMin
			}
		}
	case "solid":
		sum.SolidCount++
	}
}

// AccumulateCareSummary 将单条护理记录累加到汇总结构中，
// 供列表页按日小计与首页看板今日 KPI 共同复用。
func AccumulateCareSummary(sum *CareDailySummary, r CareRecord) {
	sum.TotalCount++
	switch r.Subtype {
	case "diaper":
		sum.DiaperCount++
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
	case "bath":
		sum.BathCount++
	case "other":
		sum.OtherCount++
	}
}
