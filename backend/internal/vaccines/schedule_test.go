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
		{"zero months", "2026-01-31", 0, "2026-01-31"},
		{"non-leap february clamp", "2026-01-31", 1, "2026-02-28"},
		{"leap february clamp", "2024-01-31", 1, "2024-02-29"},
		{"cross-year february clamp", "2026-08-31", 6, "2027-02-28"},
		{"thirty-day month clamp", "2026-03-31", 1, "2026-04-30"},
		{"six years", "2026-05-15", 72, "2032-05-15"},
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

func TestDeriveAlertStateBoundaries(t *testing.T) {
	cases := []struct {
		name      string
		status    string
		daysUntil int
		want      string
	}{
		{"pending +15d upcoming", StatusPending, 15, AlertUpcoming},
		{"pending +14d due_soon", StatusPending, 14, AlertDueSoon},
		{"pending 0d due_soon", StatusPending, 0, AlertDueSoon},
		{"pending -14d due_soon", StatusPending, -14, AlertDueSoon},
		{"pending -15d overdue", StatusPending, -15, AlertOverdue},
		{"scheduled +8d scheduled", StatusScheduled, 8, AlertScheduled},
		{"scheduled +7d scheduled_soon", StatusScheduled, 7, AlertScheduledSoon},
		{"scheduled 0d scheduled_soon", StatusScheduled, 0, AlertScheduledSoon},
		{"scheduled -1d scheduled_overdue", StatusScheduled, -1, AlertScheduledOverdue},
		{"completed always completed", StatusCompleted, -100, AlertCompleted},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := deriveAlertState(tc.status, tc.daysUntil); got != tc.want {
				t.Fatalf("deriveAlertState(%q, %d) = %q, want %q", tc.status, tc.daysUntil, got, tc.want)
			}
		})
	}
}

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
		{"empty name", CreateCustomInput{VaccineName: "   ", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: 2}}}},
		{"invalid category", CreateCustomInput{VaccineName: "四联", Category: "free", Doses: []DosePlanInput{{AgeMonths: 2}}}},
		{"empty doses", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional}},
		{"too many doses", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: make([]DosePlanInput, MaxTotalDoses+1)}},
		{"negative age", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: -1}}}},
		{"age above upper bound", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: MaxAgeMonths + 1}}}},
		{"malformed planned date", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: 2, PlannedDate: &badDate}}}},
		{"note too long", CreateCustomInput{VaccineName: "四联", Category: CategoryOptional, Doses: []DosePlanInput{{AgeMonths: 2}}, Note: strings.Repeat("a", MaxNoteLength+1)}},
	}
	for _, tc := range createCases {
		t.Run("create/"+tc.name, func(t *testing.T) {
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
		{"invalid status", UpdateDoseInput{Status: "skipped"}},
		{"scheduled without date", UpdateDoseInput{Status: StatusScheduled}},
		{"scheduled bad time", UpdateDoseInput{Status: StatusScheduled, ScheduledDate: &validDate, ScheduledTime: &badTime}},
		{"completed without date", UpdateDoseInput{Status: StatusCompleted}},
		{"completed future date", UpdateDoseInput{Status: StatusCompleted, VaccinatedAt: &futureDate}},
		{"completed before birth date", UpdateDoseInput{Status: StatusCompleted, VaccinatedAt: &beforeBirth}},
	}
	for _, tc := range updateCases {
		t.Run("update/"+tc.name, func(t *testing.T) {
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
		{"invalid action", BatchUpdateInput{Action: "delete", DoseIDs: []int64{1}}},
		{"empty dose ids", BatchUpdateInput{Action: BatchActionSchedule, ScheduledDate: &validDate}},
		{"too many dose ids", BatchUpdateInput{Action: BatchActionSchedule, DoseIDs: tooManyIDs, ScheduledDate: &validDate}},
		{"non-positive dose id", BatchUpdateInput{Action: BatchActionSchedule, DoseIDs: []int64{0}, ScheduledDate: &validDate}},
		{"schedule without date", BatchUpdateInput{Action: BatchActionSchedule, DoseIDs: []int64{1}}},
		{"complete future date", BatchUpdateInput{Action: BatchActionComplete, DoseIDs: []int64{1}, VaccinatedAt: &futureDate}},
		{"complete before birth date", BatchUpdateInput{Action: BatchActionComplete, DoseIDs: []int64{1}, VaccinatedAt: &beforeBirth}},
	}
	for _, tc := range batchCases {
		t.Run("batch/"+tc.name, func(t *testing.T) {
			_, err := validateBatchInput(tc.in, birthDate, today)
			var valErr *ValidationError
			if !errors.As(err, &valErr) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
		})
	}
}
