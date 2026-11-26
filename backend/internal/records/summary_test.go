package records

import "testing"

func TestAccumulateFeedingSummaryBreakdown(t *testing.T) {
	intPtr := func(v int) *int { return &v }
	modeDirect := "direct"
	modeBottle := "bottle"
	sideLeft := "left"
	sideRight := "right"
	sideBoth := "both"

	cases := []struct {
		name    string
		records []FeedingRecord
		want    FeedingDailySummary
	}{
		{
			name:    "空切片保持全零",
			records: nil,
			want:    FeedingDailySummary{},
		},
		{
			name: "混合配方奶瓶喂母乳亲喂与辅食精确分项累加",
			records: []FeedingRecord{
				{Subtype: FeedingSubtypeFormula, AmountML: intPtr(120)},
				{Subtype: FeedingSubtypeFormula, AmountML: intPtr(90)},
				{Subtype: FeedingSubtypeBreast, FeedingMode: &modeBottle, AmountML: intPtr(80)},
				{Subtype: FeedingSubtypeBreast, FeedingMode: &modeDirect, BreastSide: &sideLeft, DurationMin: intPtr(15)},
				{Subtype: FeedingSubtypeBreast, FeedingMode: &modeDirect, BreastSide: &sideRight, DurationMin: intPtr(12)},
				{Subtype: FeedingSubtypeBreast, FeedingMode: &modeDirect, BreastSide: &sideBoth, DurationMin: intPtr(20)},
				{Subtype: FeedingSubtypeSolid},
			},
			want: FeedingDailySummary{
				TotalML:           290,
				FormulaML:         210,
				FormulaCount:      2,
				BottleBreastML:    80,
				BottleBreastCount: 1,
				DirectBreastCount: 3,
				DirectBreastMin:   47,
				SolidCount:        1,
				TotalCount:        7,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got FeedingDailySummary
			for _, rec := range tc.records {
				AccumulateFeedingSummary(&got, rec)
			}
			if got != tc.want {
				t.Fatalf("喂养分项累加不符合预期：got=%+v, want=%+v", got, tc.want)
			}
			if got.TotalML != got.FormulaML+got.BottleBreastML {
				t.Errorf("总奶量 %d 应等于配方奶 %d + 瓶喂母乳 %d", got.TotalML, got.FormulaML, got.BottleBreastML)
			}
		})
	}
}
