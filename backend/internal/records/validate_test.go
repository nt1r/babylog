package records

import (
	"testing"
	"time"
)

func intPtr(v int) *int           { return &v }
func floatPtr(v float64) *float64 { return &v }

func TestValidateFeeding(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	validTS := "2026-11-23T09:50:00Z"

	// 合法组合
	validInputs := []FeedingInput{
		{Subtype: "breast", FeedingMode: strPtr("direct"), BreastSide: strPtr("left"), DurationMin: intPtr(15), RecordedAt: validTS},
		{Subtype: "breast", FeedingMode: strPtr("bottle"), AmountML: intPtr(110), RecordedAt: validTS},
		{Subtype: "formula", AmountML: intPtr(120), RecordedAt: validTS},
		{Subtype: "solid", SolidFood: strPtr("米粉"), SolidAmount: strPtr("半碗"), Acceptance: strPtr("like"), RecordedAt: validTS},
		{Subtype: "formula", AmountML: intPtr(90), RecordedAt: "2026-11-23T10:04:00Z"}, // +4 分钟容忍窗口内
	}
	for i, in := range validInputs {
		if _, _, err := ValidateFeeding(in, now); err != nil {
			t.Errorf("valid case %d unexpected error: %v", i, err)
		}
	}

	// 非法组合
	invalidInputs := []struct {
		name string
		in   FeedingInput
	}{
		{"超前6分钟未来时间", FeedingInput{Subtype: "formula", AmountML: intPtr(100), RecordedAt: "2026-11-23T10:06:00Z"}},
		{"亲喂缺侧别", FeedingInput{Subtype: "breast", FeedingMode: strPtr("direct"), DurationMin: intPtr(15), RecordedAt: validTS}},
		{"亲喂时长为0", FeedingInput{Subtype: "breast", FeedingMode: strPtr("direct"), BreastSide: strPtr("right"), DurationMin: intPtr(0), RecordedAt: validTS}},
		{"瓶喂母乳缺奶量", FeedingInput{Subtype: "breast", FeedingMode: strPtr("bottle"), RecordedAt: validTS}},
		{"配方奶量越界", FeedingInput{Subtype: "formula", AmountML: intPtr(1500), RecordedAt: validTS}},
		{"配方奶量非正数", FeedingInput{Subtype: "formula", AmountML: intPtr(0), RecordedAt: validTS}},
		{"辅食空名称", FeedingInput{Subtype: "solid", SolidFood: strPtr("  "), RecordedAt: validTS}},
		{"辅食非法接受度", FeedingInput{Subtype: "solid", SolidFood: strPtr("南瓜泥"), Acceptance: strPtr("love"), RecordedAt: validTS}},
		{"非法子类型", FeedingInput{Subtype: "water", RecordedAt: validTS}},
	}
	for _, tc := range invalidInputs {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := ValidateFeeding(tc.in, now); err == nil {
				t.Errorf("expected error for %s, got nil", tc.name)
			}
		})
	}
}

func TestValidateSleep(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)

	_, dur, err := ValidateSleep(SleepInput{
		Subtype:   "nap",
		StartedAt: "2026-11-23T08:00:00Z",
		EndedAt:   "2026-11-23T08:45:00Z",
	}, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dur != 45 {
		t.Fatalf("expected 45 min, got %d", dur)
	}

	invalid := []SleepInput{
		{Subtype: "nap", StartedAt: "2026-11-23T08:00:00Z", EndedAt: "2026-11-23T08:00:00Z"},
		{Subtype: "nap", StartedAt: "2026-11-23T09:00:00Z", EndedAt: "2026-11-23T08:00:00Z"},
		{Subtype: "night", StartedAt: "2026-11-21T08:00:00Z", EndedAt: "2026-11-23T09:00:00Z"}, // >24h
		{Subtype: "nap", StartedAt: "2026-11-23T09:00:00Z", EndedAt: "2026-11-23T10:10:00Z"},   // future >5m
		{Subtype: "other", StartedAt: "2026-11-23T08:00:00Z", EndedAt: "2026-11-23T08:30:00Z"},
	}
	for i, in := range invalid {
		if _, _, err := ValidateSleep(in, now); err == nil {
			t.Errorf("invalid sleep case %d expected error, got nil", i)
		}
	}
}

func TestValidateCare(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	ts := "2026-11-23T09:30:00Z"

	// 纯嘘嘘自动忽略性状字段
	peeOut, _, err := ValidateCare(CareInput{
		Subtype:          "diaper",
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

	if _, _, err := ValidateCare(CareInput{
		Subtype:          "diaper",
		DiaperKind:       strPtr("poop"),
		StoolConsistency: strPtr("soft"),
		StoolColor:       strPtr("yellow"),
		RecordedAt:       ts,
	}, now); err != nil {
		t.Fatalf("unexpected poop error: %v", err)
	}

	if _, _, err := ValidateCare(CareInput{Subtype: "bath", RecordedAt: ts}, now); err != nil {
		t.Fatalf("unexpected bath error: %v", err)
	}

	if _, _, err := ValidateCare(CareInput{Subtype: "other", CareTitle: strPtr("剪指甲"), RecordedAt: ts}, now); err != nil {
		t.Fatalf("unexpected other error: %v", err)
	}

	invalid := []CareInput{
		{Subtype: "diaper", RecordedAt: ts},
		{Subtype: "diaper", DiaperKind: strPtr("invalid"), RecordedAt: ts},
		{Subtype: "diaper", DiaperKind: strPtr("poop"), StoolConsistency: strPtr("unknown"), RecordedAt: ts},
		{Subtype: "diaper", DiaperKind: strPtr("both"), StoolColor: strPtr("blue"), RecordedAt: ts},
		{Subtype: "other", CareTitle: strPtr("  "), RecordedAt: ts},
	}
	for i, in := range invalid {
		if _, _, err := ValidateCare(in, now); err == nil {
			t.Errorf("invalid care case %d expected error, got nil", i)
		}
	}
}

func TestValidateHealth(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	ts := "2026-11-23T09:30:00Z"

	valid := []HealthInput{
		{Subtype: "temperature", TemperatureC: floatPtr(38.64), RecordedAt: ts},
		{Subtype: "medicine", MedicineName: strPtr("维生素 D3"), MedicineDosage: strPtr("1 粒"), RecordedAt: ts},
		{Subtype: "growth", WeightKg: floatPtr(6.8), RecordedAt: ts},
		{Subtype: "growth", HeightCm: floatPtr(64.5), HeadCm: floatPtr(41.2), RecordedAt: ts},
		{Subtype: "teeth", ToothNote: strPtr("下中切牙（第 1 颗）"), RecordedAt: ts},
	}
	for i, in := range valid {
		if _, _, err := ValidateHealth(in, now); err != nil {
			t.Errorf("valid health case %d unexpected error: %v", i, err)
		}
	}

	invalid := []HealthInput{
		{Subtype: "temperature", RecordedAt: ts},
		{Subtype: "temperature", TemperatureC: floatPtr(33.5), RecordedAt: ts},
		{Subtype: "temperature", TemperatureC: floatPtr(44.0), RecordedAt: ts},
		{Subtype: "medicine", MedicineName: strPtr("   "), RecordedAt: ts},
		{Subtype: "growth", RecordedAt: ts},
		{Subtype: "growth", WeightKg: floatPtr(0), RecordedAt: ts},
		{Subtype: "teeth", ToothNote: strPtr(""), RecordedAt: ts},
	}
	for i, in := range invalid {
		if _, _, err := ValidateHealth(in, now); err == nil {
			t.Errorf("invalid health case %d expected error, got nil", i)
		}
	}
}
