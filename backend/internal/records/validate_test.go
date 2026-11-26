package records

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
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
	accumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNight}, 360)
	accumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNap}, 45)
	accumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNap}, 0) // 忽略非正分钟数
	accumulateSleepSummary(&sleepSum, SleepRecord{Subtype: SleepSubtypeNight}, -10)

	if sleepSum.TotalMin != 405 || sleepSum.NightMin != 360 || sleepSum.NapCount != 1 {
		t.Fatalf("unexpected sleep summary: %#v", sleepSum)
	}

	var healthSum HealthDailySummary
	// 按降序遍历时首条体温成为 LatestTempC
	accumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(38.2)})
	accumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(36.7)})
	accumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeMedicine})
	accumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeGrowth})
	accumulateHealthSummary(&healthSum, HealthRecord{Subtype: HealthSubtypeTeeth})

	if healthSum.TotalCount != 5 || healthSum.MedicineCount != 1 {
		t.Fatalf("unexpected health counts: %#v", healthSum)
	}
	if healthSum.LatestTempC == nil || *healthSum.LatestTempC != 38.2 {
		t.Fatalf("expected LatestTempC=38.2, got %v", healthSum.LatestTempC)
	}
}

func TestSummarizeSleepByLocalDayAndMedicine(t *testing.T) {
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}

	sleeps := []SleepRecord{
		{
			Subtype:   SleepSubtypeNight,
			StartedAt: "2026-11-22T14:00:00Z", // 上海 22:00
			EndedAt:   "2026-11-22T22:00:00Z", // 上海次日 06:00
		},
		{
			Subtype:   SleepSubtypeNap,
			StartedAt: "2026-11-23T05:00:00Z", // 上海 13:00
			EndedAt:   "2026-11-23T05:45:00Z", // 上海 13:45
		},
		{
			Subtype:   SleepSubtypeNap,
			StartedAt: "invalid",
			EndedAt:   "2026-11-23T06:00:00Z",
		},
	}
	byDay := SummarizeSleepByLocalDay(sleeps, shanghai)
	if got := byDay["2026-11-22"]; got.TotalMin != 120 || got.NightMin != 120 || got.NapCount != 0 {
		t.Fatalf("unexpected 2026-11-22 summary: %+v", got)
	}
	if got := byDay["2026-11-23"]; got.TotalMin != 405 || got.NightMin != 360 || got.NapCount != 1 {
		t.Fatalf("unexpected 2026-11-23 summary: %+v", got)
	}

	// 同时间戳按较大 ID 决胜，且最新一条药名为 nil 时应清空旧药名。
	med := SummarizeMedicine([]HealthRecord{
		{ID: 1, Subtype: HealthSubtypeTemperature, TemperatureC: floatPtr(37.2), RecordedAt: "2026-11-23T09:00:00Z"},
		{ID: 2, Subtype: HealthSubtypeMedicine, MedicineName: strPtr("维生素 D3"), RecordedAt: "2026-11-23T08:00:00Z"},
		{ID: 5, Subtype: HealthSubtypeMedicine, MedicineName: strPtr("布洛芬"), RecordedAt: "2026-11-23T08:00:00Z"},
		{ID: 3, Subtype: HealthSubtypeMedicine, MedicineName: strPtr("早间钙剂"), RecordedAt: "2026-11-23T07:00:00Z"},
	})
	if med.Count != 3 || med.LatestName == nil || *med.LatestName != "布洛芬" || med.LatestAt == nil || *med.LatestAt != "2026-11-23T08:00:00Z" {
		t.Fatalf("unexpected medicine summary: %+v", med)
	}

	medNilLatest := SummarizeMedicine([]HealthRecord{
		{ID: 1, Subtype: HealthSubtypeMedicine, MedicineName: strPtr("维生素 D3"), RecordedAt: "2026-11-23T08:00:00Z"},
		{ID: 2, Subtype: HealthSubtypeMedicine, MedicineName: nil, RecordedAt: "2026-11-23T09:00:00Z"},
	})
	if medNilLatest.Count != 2 || medNilLatest.LatestName != nil || medNilLatest.LatestAt == nil || *medNilLatest.LatestAt != "2026-11-23T09:00:00Z" {
		t.Fatalf("expected nil LatestName when latest medicine has nil name, got %+v", medNilLatest)
	}
}

func TestValidateBatchCreate(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	ts := "2026-11-23T09:30:00Z"

	// 合法混合批次：亲喂 + 瓶喂母乳 + 配方奶 + 合并尿布（含备注裁剪与纯空白归一化）
	validRes, err := ValidateBatchCreate(BatchCreateInput{
		Feedings: []FeedingInput{
			{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("direct"), BreastSide: strPtr("left"), DurationMin: intPtr(15), RecordedAt: ts, Note: "  月嫂补录  "},
			{Subtype: FeedingSubtypeBreast, FeedingMode: strPtr("bottle"), AmountML: intPtr(40), RecordedAt: ts, Note: "   "},
			{Subtype: FeedingSubtypeFormula, AmountML: intPtr(60), RecordedAt: ts, Note: "  月嫂补录  "},
		},
		Cares: []CareInput{
			{Subtype: CareSubtypeDiaper, DiaperKind: strPtr("both"), StoolConsistency: strPtr("soft"), StoolColor: strPtr("yellow"), RecordedAt: ts, Note: "  月嫂补录  "},
		},
	}, now)
	if err != nil {
		t.Fatalf("合法混合批量校验不应失败：%v", err)
	}
	if len(validRes.Feedings) != 3 || len(validRes.Cares) != 1 {
		t.Fatalf("预期返回 3 条喂养与 1 条护理，实际 feedings=%d cares=%d", len(validRes.Feedings), len(validRes.Cares))
	}
	if validRes.Feedings[0].Note != "月嫂补录" || validRes.Feedings[1].Note != "" || validRes.Cares[0].Note != "月嫂补录" {
		t.Fatalf("批量备注应完成首尾裁剪与纯空白归一化：f0=%q f1=%q care=%q", validRes.Feedings[0].Note, validRes.Feedings[1].Note, validRes.Cares[0].Note)
	}

	// 构造超出上限的 21 条记录
	oversizedFeedings := make([]FeedingInput, MaxBatchCreateItems+1)
	for i := range oversizedFeedings {
		oversizedFeedings[i] = FeedingInput{Subtype: FeedingSubtypeFormula, AmountML: intPtr(60), RecordedAt: ts}
	}

	invalidCases := []struct {
		name       string
		in         BatchCreateInput
		wantSubstr string
	}{
		{
			name:       "空批次(nil切片)",
			in:         BatchCreateInput{},
			wantSubstr: "至少填写一项",
		},
		{
			name:       "空批次(空切片)",
			in:         BatchCreateInput{Feedings: []FeedingInput{}, Cares: []CareInput{}},
			wantSubstr: "至少填写一项",
		},
		{
			name:       "超出单次20条上限",
			in:         BatchCreateInput{Feedings: oversizedFeedings},
			wantSubstr: "最多批量提交 20 条",
		},
		{
			name: "含非法喂养奶量",
			in: BatchCreateInput{
				Feedings: []FeedingInput{
					{Subtype: FeedingSubtypeFormula, AmountML: intPtr(90), RecordedAt: ts},
					{Subtype: FeedingSubtypeFormula, AmountML: intPtr(0), RecordedAt: ts},
				},
			},
			wantSubstr: "第 2 条喂养记录",
		},
		{
			name: "含非法护理项",
			in: BatchCreateInput{
				Feedings: []FeedingInput{{Subtype: FeedingSubtypeFormula, AmountML: intPtr(90), RecordedAt: ts}},
				Cares:    []CareInput{{Subtype: CareSubtypeDiaper, RecordedAt: ts}},
			},
			wantSubstr: "第 1 条护理记录",
		},
		{
			name: "含超前5分钟未来时间戳",
			in: BatchCreateInput{
				Feedings: []FeedingInput{{Subtype: FeedingSubtypeFormula, AmountML: intPtr(90), RecordedAt: "2026-11-23T10:06:00Z"}},
			},
			wantSubstr: "不能晚于当前时间",
		},
	}

	for _, tc := range invalidCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateBatchCreate(tc.in, now)
			assertValidationErr(t, tc.name, err)
			if err != nil && !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Errorf("%s: 预期错误包含 %q，实际 %q", tc.name, tc.wantSubstr, err.Error())
			}
		})
	}
}
