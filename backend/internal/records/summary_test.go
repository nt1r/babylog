package records

import (
	"slices"
	"testing"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func TestWindowSnapshotSummarizeByLocalDay(t *testing.T) {
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}

	intPtr := func(v int) *int { return &v }
	floatPtr := func(v float64) *float64 { return &v }
	strPtr := func(v string) *string { return &v }

	t.Run("空快照与nil接收者返回空映射", func(t *testing.T) {
		var nilSnap *WindowSnapshot
		if got := nilSnap.SummarizeByLocalDay(shanghai); len(got) != 0 {
			t.Fatalf("nil 快照预期空映射，实际 %+v", got)
		}
		if got := (&WindowSnapshot{}).SummarizeByLocalDay(shanghai); len(got) != 0 {
			t.Fatalf("空快照预期空映射，实际 %+v", got)
		}
	})

	t.Run("统一按本地自然日汇总五类记录含喂养分项跨夜睡眠与无序生长决胜", func(t *testing.T) {
		snap := &WindowSnapshot{
			Feedings: []FeedingRecord{
				{Subtype: FeedingSubtypeFormula, AmountML: intPtr(120), RecordedAt: "2026-11-23T01:00:00Z"},
				{Subtype: FeedingSubtypeFormula, AmountML: intPtr(90), RecordedAt: "2026-11-23T04:00:00Z"},
				{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr(FeedingModeBottle), AmountML: intPtr(80), RecordedAt: "2026-11-23T06:00:00Z"},
				{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr(FeedingModeDirect), BreastSide: strPtr(BreastSideLeft), DurationMin: intPtr(15), RecordedAt: "2026-11-23T08:00:00Z"},
				{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr(FeedingModeDirect), BreastSide: strPtr(BreastSideRight), DurationMin: intPtr(12), RecordedAt: "2026-11-23T10:00:00Z"},
				{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr(FeedingModeDirect), BreastSide: strPtr(BreastSideBoth), DurationMin: intPtr(20), RecordedAt: "2026-11-23T12:00:00Z"},
				{Subtype: FeedingSubtypeSolid, RecordedAt: "2026-11-23T05:00:00Z"},
			},
			Sleeps: []SleepRecord{
				{Subtype: SleepSubtypeNight, StartedAt: "2026-11-22T14:00:00Z", EndedAt: "2026-11-22T22:00:00Z"},
				{Subtype: SleepSubtypeNap, StartedAt: "2026-11-23T05:00:00Z", EndedAt: "2026-11-23T05:45:00Z"},
			},
			Cares: []CareRecord{
				{Subtype: CareSubtypeDiaper, DiaperKind: strPtr(DiaperKindBoth), RecordedAt: "2026-11-23T02:00:00Z"},
				{Subtype: CareSubtypeBath, RecordedAt: "2026-11-23T11:00:00Z"},
			},
			Healths: []HealthRecord{
				{ID: 1, Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(37.2), RecordedAt: "2026-11-23T03:00:00Z"},
				{ID: 2, Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(38.4), RecordedAt: "2026-11-23T07:00:00Z"},
				{ID: 3, Subtype: HealthSubtypeMedicine, MedicineName: strPtr("维生素 D3"), RecordedAt: "2026-11-23T08:00:00Z"},
			},
			// 刻意按逆序输入同日体格与出牙记录，验证 SummarizeByLocalDay 内部按 (RecordedAt, ID) 升序决胜，不依赖调用方预排序。
			Growths: []HealthRecord{
				{ID: 12, Subtype: HealthSubtypeGrowth, WeightKg: floatPtr(6.5), RecordedAt: "2026-11-23T09:00:00Z"},
				{ID: 10, Subtype: HealthSubtypeGrowth, WeightKg: floatPtr(6.2), HeightCm: floatPtr(62.0), RecordedAt: "2026-11-23T02:00:00Z"},
				{ID: 11, Subtype: HealthSubtypeGrowth, HeadCm: floatPtr(41.5), RecordedAt: "2026-11-23T09:00:00Z"},
				{ID: 15, Subtype: HealthSubtypeTeeth, ToothNote: strPtr("右下门牙"), RecordedAt: "2026-11-23T10:00:00Z"},
				{ID: 14, Subtype: HealthSubtypeTeeth, ToothNote: strPtr("左下门牙"), RecordedAt: "2026-11-23T03:00:00Z"},
			},
		}

		byDay := snap.SummarizeByLocalDay(shanghai)
		prev := byDay["2026-11-22"]
		if prev.Sleep.TotalMin != 120 || prev.Sleep.NightMin != 120 || prev.Sleep.NapMin() != 0 || prev.Sleep.TotalHours() != 2.0 {
			t.Fatalf("2026-11-22 跨夜切分不符合预期：%+v", prev.Sleep)
		}

		day := byDay["2026-11-23"]
		wantFeed := FeedingDailySummary{
			TotalML:           290,
			FormulaML:         210,
			FormulaCount:      2,
			BottleBreastML:    80,
			BottleBreastCount: 1,
			DirectBreastCount: 3,
			DirectBreastMin:   47,
			SolidCount:        1,
			TotalCount:        7,
		}
		if day.Feeding != wantFeed {
			t.Fatalf("喂养分项汇总不符合预期：got=%+v want=%+v", day.Feeding, wantFeed)
		}
		if day.Sleep.TotalMin != 405 || day.Sleep.NightMin != 360 || day.Sleep.NapMin() != 45 ||
			day.Sleep.NapCount != 1 || day.Sleep.TotalHours() != 6.8 || day.Sleep.NightHours() != 6.0 || day.Sleep.NapHours() != 0.8 {
			t.Fatalf("睡眠汇总与小时换算不符合预期：%+v", day.Sleep)
		}
		if day.Care.PeeCount != 1 || day.Care.PoopCount != 1 || day.Care.BathCount != 1 || day.Care.TotalCount != 2 {
			t.Fatalf("护理汇总不符合预期：%+v", day.Care)
		}
		if day.Health.MaxTempC == nil || *day.Health.MaxTempC != 38.4 || day.Health.MedicineCount != 1 {
			t.Fatalf("临床健康汇总不符合预期：%+v", day.Health)
		}
		if day.Growth.WeightKg == nil || *day.Growth.WeightKg != 6.5 ||
			day.Growth.HeightCm == nil || *day.Growth.HeightCm != 62.0 ||
			day.Growth.HeadCm == nil || *day.Growth.HeadCm != 41.5 {
			t.Fatalf("同日多条生长测量字段合并决胜不符合预期：%+v", day.Growth)
		}
		if !slices.Equal(day.Growth.Teeth, []string{"左下门牙", "右下门牙"}) {
			t.Fatalf("同日出牙说明应按时间升序排列，实际 %+v", day.Growth.Teeth)
		}
	})
}
