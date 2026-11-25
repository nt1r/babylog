package vaccines

import (
	"errors"
	"strings"
	"testing"
)

func TestAddCalendarMonthsClamped(t *testing.T) {
	cases := []struct {
		name   string
		base   string
		months int
		want   string
	}{
		{"加0个月保持原日", "2026-01-31", 0, "2026-01-31"},
		{"平年2月末钳位", "2026-01-31", 1, "2026-02-28"},
		{"闰年2月末钳位", "2024-01-31", 1, "2024-02-29"},
		{"跨年2月末钳位", "2026-08-31", 6, "2027-02-28"},
		{"小月30日钳位", "2026-03-31", 1, "2026-04-30"},
		{"跨6年整月累加", "2026-05-15", 72, "2032-05-15"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := addCalendarMonthsClamped(tc.base, tc.months)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Fatalf("addCalendarMonthsClamped(%q, %d) = %q, want %q", tc.base, tc.months, got, tc.want)
			}
		})
	}
}

func TestBuildDoseViewPlannedDateOverride(t *testing.T) {
	code := "hepb"
	rec := DoseRecord{
		ID:           1,
		TemplateCode: &code,
		DoseNumber:   2,
		TotalDoses:   3,
		VaccineName:  "乙肝疫苗",
		Category:     CategoryNIP,
		AgeMonths:    1,
		AgeLabel:     "1月龄",
		Status:       StatusPending,
	}

	// 未手动覆盖时按出生日 2026-01-31 + 1 月钳位为 2026-02-28。
	vDefault := buildDoseView(rec, "2026-01-31", "2026-03-10")
	if vDefault.DefaultDueDate != "2026-02-28" || vDefault.EffectiveDate != "2026-02-28" {
		t.Fatalf("expected default due/effective 2026-02-28, got %s / %s", vDefault.DefaultDueDate, vDefault.EffectiveDate)
	}

	// 手动设置 planned_date 后，effective_date 采用手动覆盖值而 default_due_date 保持基准值。
	manual := "2026-03-28"
	rec.PlannedDate = &manual
	vOverride := buildDoseView(rec, "2026-01-31", "2026-03-10")
	if vOverride.DefaultDueDate != "2026-02-28" || vOverride.EffectiveDate != manual || vOverride.AlertState != AlertUpcoming {
		t.Fatalf("unexpected planned_date override view: default=%s effective=%s alert=%s",
			vOverride.DefaultDueDate, vOverride.EffectiveDate, vOverride.AlertState)
	}
}

// 验证 7 态提醒状态机精确阈值：待接种 ±14 天内为 due_soon、逾期超 14 天为 overdue；
// 已预约 0~7 天为 scheduled_soon、过日为 scheduled_overdue。
func TestDeriveAlertStateBoundaries(t *testing.T) {
	cases := []struct {
		name      string
		status    string
		daysUntil int
		want      string
	}{
		{"待接种提前15天_未到龄", StatusPending, 15, AlertUpcoming},
		{"待接种提前14天_近期可接种", StatusPending, 14, AlertDueSoon},
		{"待接种当天_近期可接种", StatusPending, 0, AlertDueSoon},
		{"待接种逾期14天_近期可接种", StatusPending, -14, AlertDueSoon},
		{"待接种逾期15天_待补种", StatusPending, -15, AlertOverdue},
		{"已预约提前8天_远期已预约", StatusScheduled, 8, AlertScheduled},
		{"已预约提前7天_即将接种", StatusScheduled, 7, AlertScheduledSoon},
		{"已预约当天_即将接种", StatusScheduled, 0, AlertScheduledSoon},
		{"已预约逾期1天_预约已过期", StatusScheduled, -1, AlertScheduledOverdue},
		{"已接种恒为已完成", StatusCompleted, -100, AlertCompleted},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := deriveAlertState(tc.status, tc.daysUntil); got != tc.want {
				t.Fatalf("deriveAlertState(%q, %d) = %q, want %q", tc.status, tc.daysUntil, got, tc.want)
			}
		})
	}
}

// 验证内置目录符合 2025 年国家免疫规划基线（8 种共 22 剂 NIP、百白破 2/4/6/18/72 月龄 5 剂、2 剂产院疫苗）及 5 套自费模板完整性。
func TestBuiltInCatalogIntegrity(t *testing.T) {
	nips := nipTemplates()
	if len(nips) != 8 {
		t.Fatalf("expected 8 NIP vaccine types, got %d", len(nips))
	}

	totalNIPDoses := 0
	var dtapMonths []int
	birthHospitalCount := 0
	for _, tpl := range nips {
		if tpl.RiskWarning == "" || tpl.Prevents == "" || tpl.Route == "" {
			t.Fatalf("NIP template %q missing required reference metadata", tpl.Code)
		}
		totalNIPDoses += len(tpl.Doses)
		for _, d := range tpl.Doses {
			if tpl.Code == "dtap" {
				dtapMonths = append(dtapMonths, d.AgeMonths)
			}
			if d.IsBirthHospital {
				birthHospitalCount++
			}
		}
	}

	if totalNIPDoses != 22 {
		t.Fatalf("expected 22 NIP baseline doses, got %d", totalNIPDoses)
	}
	wantDTaP := []int{2, 4, 6, 18, 72}
	if len(dtapMonths) != len(wantDTaP) {
		t.Fatalf("expected DTaP 5 doses (2025 schedule), got %v", dtapMonths)
	}
	for i := range wantDTaP {
		if dtapMonths[i] != wantDTaP[i] {
			t.Fatalf("DTaP dose %d age_months = %d, want %d", i+1, dtapMonths[i], wantDTaP[i])
		}
	}
	if birthHospitalCount != 2 {
		t.Fatalf("expected exactly 2 birth-hospital doses (HepB#1 and BCG), got %d", birthHospitalCount)
	}

	optionals := optionalTemplates()
	if len(optionals) != 5 {
		t.Fatalf("expected 5 conflict-free optional templates, got %d", len(optionals))
	}
	for _, tpl := range optionals {
		if tpl.RiskWarning == "" || len(tpl.Doses) == 0 {
			t.Fatalf("optional template %q incomplete", tpl.Code)
		}
	}
}

func TestValidationRules(t *testing.T) {
	badDate := "2026/05/01"
	birthDate := "2026-01-15"
	beforeBirth := "2026-01-14"
	futureDate := "2026-06-16"
	today := "2026-06-15"
	badTime := "25:99"
	validDate := "2026-06-15"

	createCases := []struct {
		name string
		in   CreateCustomInput
	}{
		{"空疫苗名称", CreateCustomInput{VaccineName: "   ", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: 2}}}},
		{"非法疫苗分类", CreateCustomInput{VaccineName: "四联", Category: "free", Doses: []DosePlanInput{{AgeMonths: 2}}}},
		{"空剂次列表", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional}},
		{"剂次数超上限", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: make([]DosePlanInput, MaxTotalDoses+1)}},
		{"负适龄月龄", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: -1}}}},
		{"适龄月龄超上限", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: MaxAgeMonths + 1}}}},
		{"预计日期格式错误", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: 2, PlannedDate: &badDate}}}},
		{"备注超长", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: 2}}, Note: strings.Repeat("a", MaxNoteLength+1)}},
	}
	for _, tc := range createCases {
		t.Run("新增/"+tc.name, func(t *testing.T) {
			_, err := validateCreateInput(tc.in)
			var valErr *ValidationError
			if !errors.As(err, &valErr) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
		})
	}

	updateCases := []struct {
		name string
		in   UpdateDoseInput
	}{
		{"非法状态", UpdateDoseInput{Status: "skipped"}},
		{"已预约缺少日期", UpdateDoseInput{Status: StatusScheduled}},
		{"已预约时间格式错误", UpdateDoseInput{Status: StatusScheduled, ScheduledDate: &validDate, ScheduledTime: &badTime}},
		{"已接种缺少日期", UpdateDoseInput{Status: StatusCompleted}},
		{"已接种未来日期", UpdateDoseInput{Status: StatusCompleted, VaccinatedAt: &futureDate}},
		{"已接种早于出生日", UpdateDoseInput{Status: StatusCompleted, VaccinatedAt: &beforeBirth}},
	}
	for _, tc := range updateCases {
		t.Run("更新/"+tc.name, func(t *testing.T) {
			_, err := validateUpdateInput(tc.in, birthDate, today)
			var valErr *ValidationError
			if !errors.As(err, &valErr) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
		})
	}

	tooManyIDs := make([]int64, MaxBatchDoseCount+1)
	for i := range tooManyIDs {
		tooManyIDs[i] = int64(i + 1)
	}
	batchCases := []struct {
		name string
		in   BatchUpdateInput
	}{
		{"非法批量动作", BatchUpdateInput{Action: "delete", DoseIDs: []int64{1}}},
		{"空剂次ID列表", BatchUpdateInput{Action: BatchActionSchedule, ScheduledDate: &validDate}},
		{"剂次ID超上限", BatchUpdateInput{Action: BatchActionSchedule, DoseIDs: tooManyIDs, ScheduledDate: &validDate}},
		{"非正剂次ID", BatchUpdateInput{Action: BatchActionSchedule, DoseIDs: []int64{0}, ScheduledDate: &validDate}},
		{"批量预约缺少日期", BatchUpdateInput{Action: BatchActionSchedule, DoseIDs: []int64{1}}},
		{"批量已接种未来日期", BatchUpdateInput{Action: BatchActionComplete, DoseIDs: []int64{1}, VaccinatedAt: &futureDate}},
		{"批量已接种早于出生日", BatchUpdateInput{Action: BatchActionComplete, DoseIDs: []int64{1}, VaccinatedAt: &beforeBirth}},
	}
	for _, tc := range batchCases {
		t.Run("批量/"+tc.name, func(t *testing.T) {
			_, err := validateBatchInput(tc.in, birthDate, today)
			var valErr *ValidationError
			if !errors.As(err, &valErr) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
		})
	}
}
