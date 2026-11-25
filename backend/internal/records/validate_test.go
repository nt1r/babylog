package records

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func intPtr(v int) *int           { return &v }
func floatPtr(v float64) *float64 { return &v }

func assertValidationErr(t *testing.T, label string, err error) {
	t.Helper()
	var valErr *ValidationError
	if !errors.As(err, &valErr) || strings.TrimSpace(valErr.Message) == "" {
		t.Errorf("%s: expected non-empty *ValidationError, got %T: %v", label, err, err)
	}
}

func TestValidateFeeding(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	validTS := "2026-11-23T09:50:00Z"

	validInputs := []FeedingInput{
		{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("direct"), BreastSide: strPtr("left"), DurationMin: intPtr(15), RecordedAt: validTS},
		{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("bottle"), AmountML: intPtr(110), RecordedAt: validTS},
		{Subtype: FeedingSubtypeFormula, AmountML: intPtr(120), RecordedAt: validTS},
		{Subtype: FeedingSubtypeSolid, SolidFood: strPtr("米粉"), SolidAmount: strPtr("半碗"), Acceptance: strPtr("like"), RecordedAt: validTS},
		{Subtype: FeedingSubtypeFormula, AmountML: intPtr(90), RecordedAt: "2026-11-23T10:04:00Z"}, // +4 分钟容忍窗口内
	}
	for i, in := range validInputs {
		if _, err := ValidateFeeding(in, now); err != nil {
			t.Errorf("valid case %d unexpected error: %v", i, err)
		}
	}

	invalidInputs := []struct {
		name string
		in   FeedingInput
	}{
		{"超前6分钟未来时间", FeedingInput{Subtype: FeedingSubtypeFormula, AmountML: intPtr(100), RecordedAt: "2026-11-23T10:06:00Z"}},
		{"亲喂缺侧别", FeedingInput{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("direct"), DurationMin: intPtr(15), RecordedAt: validTS}},
		{"亲喂时长为0", FeedingInput{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("direct"), BreastSide: strPtr("right"), DurationMin: intPtr(0), RecordedAt: validTS}},
		{"瓶喂母乳缺奶量", FeedingInput{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("bottle"), RecordedAt: validTS}},
		{"配方奶量越界", FeedingInput{Subtype: FeedingSubtypeFormula, AmountML: intPtr(1500), RecordedAt: validTS}},
		{"配方奶量非正数", FeedingInput{Subtype: FeedingSubtypeFormula, AmountML: intPtr(0), RecordedAt: validTS}},
		{"辅食空名称", FeedingInput{Subtype: FeedingSubtypeSolid, SolidFood: strPtr("  "), RecordedAt: validTS}},
		{"辅食非法接受度", FeedingInput{Subtype: FeedingSubtypeSolid, SolidFood: strPtr("南瓜泥"), Acceptance: strPtr("love"), RecordedAt: validTS}},
		{"非法子类型", FeedingInput{Subtype: "water", RecordedAt: validTS}},
	}
	for _, tc := range invalidInputs {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateFeeding(tc.in, now)
			assertValidationErr(t, tc.name, err)
		})
	}
}

func TestValidateSleep(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)

	_, dur, err := ValidateSleep(SleepInput{
		Subtype:   SleepSubtypeNap,
		StartedAt: "2026-11-23T08:00:00Z",
		EndedAt:   "2026-11-23T08:45:00Z",
	}, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dur != 45 {
		t.Fatalf("expected 45 min, got %d", dur)
	}

	invalid := []struct {
		name string
		in   SleepInput
	}{
		{"起止时间相等", SleepInput{Subtype: SleepSubtypeNap, StartedAt: "2026-11-23T08:00:00Z", EndedAt: "2026-11-23T08:00:00Z"}},
		{"结束早于开始", SleepInput{Subtype: SleepSubtypeNap, StartedAt: "2026-11-23T09:00:00Z", EndedAt: "2026-11-23T08:00:00Z"}},
		{"超过24小时", SleepInput{Subtype: SleepSubtypeNight, StartedAt: "2026-11-21T08:00:00Z", EndedAt: "2026-11-23T09:00:00Z"}},
		{"超前超过5分钟", SleepInput{Subtype: SleepSubtypeNap, StartedAt: "2026-11-23T09:00:00Z", EndedAt: "2026-11-23T10:10:00Z"}},
		{"非法子类型", SleepInput{Subtype: "other", StartedAt: "2026-11-23T08:00:00Z", EndedAt: "2026-11-23T08:30:00Z"}},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := ValidateSleep(tc.in, now)
			assertValidationErr(t, tc.name, err)
		})
	}
}

func TestValidateCare(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	ts := "2026-11-23T09:30:00Z"

	// 纯嘘嘘自动忽略性状字段
	peeOut, err := ValidateCare(CareInput{
		Subtype:          CareSubtypeDiaper,
		DiaperKind:       strPtr("pee"),
		StoolConsistency: strPtr("soft"),
		RecordedAt:       ts,
	}, now)
	if err != nil {
		t.Fatalf("unexpected pee error: %v", err)
	}
	if peeOut.StoolConsistency != nil {
		t.Errorf("expected nil stool consistency for pee, got %v", *peeOut.StoolConsistency)
	}

	if _, err := ValidateCare(CareInput{
		Subtype:          CareSubtypeDiaper,
		DiaperKind:       strPtr("poop"),
		StoolConsistency: strPtr("soft"),
		StoolColor:       strPtr("yellow"),
		RecordedAt:       ts,
	}, now); err != nil {
		t.Fatalf("unexpected poop error: %v", err)
	}

	if _, err := ValidateCare(CareInput{Subtype: CareSubtypeBath, RecordedAt: ts}, now); err != nil {
		t.Fatalf("unexpected bath error: %v", err)
	}

	if _, err := ValidateCare(CareInput{Subtype: CareSubtypeOther, CareTitle: strPtr("剪指甲"), RecordedAt: ts}, now); err != nil {
		t.Fatalf("unexpected other error: %v", err)
	}

	invalid := []struct {
		name string
		in   CareInput
	}{
		{"缺尿布类型", CareInput{Subtype: CareSubtypeDiaper, RecordedAt: ts}},
		{"非法尿布类型", CareInput{Subtype: CareSubtypeDiaper, DiaperKind: strPtr("invalid"), RecordedAt: ts}},
		{"非法便便性状", CareInput{Subtype: CareSubtypeDiaper, DiaperKind: strPtr("poop"), StoolConsistency: strPtr("unknown"), RecordedAt: ts}},
		{"非法便便颜色", CareInput{Subtype: CareSubtypeDiaper, DiaperKind: strPtr("both"), StoolColor: strPtr("blue"), RecordedAt: ts}},
		{"空白自定义护理标题", CareInput{Subtype: CareSubtypeOther, CareTitle: strPtr("  "), RecordedAt: ts}},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateCare(tc.in, now)
			assertValidationErr(t, tc.name, err)
		})
	}
}

func TestValidateHealth(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	ts := "2026-11-23T09:30:00Z"

	valid := []HealthInput{
		{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(38.64), RecordedAt: ts},
		{Subtype: HealthSubtypeMedicine, MedicineName: strPtr("维生素 D3"), MedicineDosage: strPtr("1 粒"), RecordedAt: ts},
		{Subtype: HealthSubtypeGrowth, WeightKg: floatPtr(6.8), RecordedAt: ts},
		{Subtype: HealthSubtypeGrowth, HeightCm: floatPtr(64.5), HeadCm: floatPtr(41.2), RecordedAt: ts},
		{Subtype: HealthSubtypeTeeth, ToothNote: strPtr("下中切牙（第 1 颗）"), RecordedAt: ts},
	}
	for i, in := range valid {
		if _, err := ValidateHealth(in, now); err != nil {
			t.Errorf("valid health case %d unexpected error: %v", i, err)
		}
	}

	invalid := []struct {
		name string
		in   HealthInput
	}{
		{"缺体温值", HealthInput{Subtype: HealthSubtypeTemperature, RecordedAt: ts}},
		{"体温过低", HealthInput{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(33.5), RecordedAt: ts}},
		{"体温过高", HealthInput{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(44.0), RecordedAt: ts}},
		{"空药名", HealthInput{Subtype: HealthSubtypeMedicine, MedicineName: strPtr("   "), RecordedAt: ts}},
		{"空生长测量", HealthInput{Subtype: HealthSubtypeGrowth, RecordedAt: ts}},
		{"零体重", HealthInput{Subtype: HealthSubtypeGrowth, WeightKg: floatPtr(0), RecordedAt: ts}},
		{"空长牙备注", HealthInput{Subtype: HealthSubtypeTeeth, ToothNote: strPtr(""), RecordedAt: ts}},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateHealth(tc.in, now)
			assertValidationErr(t, tc.name, err)
		})
	}
}

func TestAccumulateSleepAndHealthSummary(t *testing.T) {
	var sleepSum SleepDailySummary
	AccumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNight}, 360)
	AccumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNap}, 45)
	AccumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNap}, 0) // 忽略非正分钟数
	AccumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNight}, -10)

	if sleepSum.TotalMin != 405 || sleepSum.NightMin != 360 || sleepSum.NapCount != 1 {
		t.Fatalf("unexpected sleep summary: %#v", sleepSum)
	}

	var healthSum HealthDailySummary
	// 按降序遍历时首条体温成为 LatestTempC
	AccumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(38.2)})
	AccumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(36.7)})
	AccumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeMedicine})
	AccumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeGrowth})
	AccumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeTeeth})

	if healthSum.TotalCount != 5 || healthSum.MedicineCount != 1 {
		t.Fatalf("unexpected health counts: %#v", healthSum)
	}
	if healthSum.LatestTempC == nil || *healthSum.LatestTempC != 38.2 {
		t.Fatalf("expected LatestTempC=38.2, got %v", healthSum.LatestTempC)
	}
}
