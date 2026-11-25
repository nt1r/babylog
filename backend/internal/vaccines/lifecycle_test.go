package vaccines

import "testing"

func strPtr(v string) *string { return &v }
func intPtr(v int) *int       { return &v }

// TestIsProtectedNIPConsistency 验证内置 NIP 保护谓词在模板与剂次上口径一致，并放行自费模板与自定义免费剂次。
func TestIsProtectedNIPConsistency(t *testing.T) {
	hepbCode := "hepb"
	pcvCode := "pcv13"

	cases := []struct {
		name string
		rec  DoseRecord
		want bool
	}{
		{"内置NIP受保护", DoseRecord{TemplateCode: &hepbCode, Category: CategoryNIP}, true},
		{"自费模板不锁定", DoseRecord{TemplateCode: &pcvCode, Category: CategoryOptional}, false},
		{"自定义免费疫苗不锁定", DoseRecord{TemplateCode: nil, Category: CategoryNIP}, false},
		{"自定义自费疫苗不锁定", DoseRecord{TemplateCode: nil, Category: CategoryOptional}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.rec.isProtectedNIP(); got != tc.want {
				t.Fatalf("isProtectedNIP() = %v, want %v", got, tc.want)
			}
			view := buildDoseView(tc.rec, "2026-01-15", "2026-06-15")
			if view.Deletable != !tc.want {
				t.Fatalf("buildDoseView().Deletable = %v, want %v", view.Deletable, !tc.want)
			}
		})
	}

	if tpl, ok := lookupTemplate("hepb"); !ok || !tpl.isProtectedNIP() {
		t.Fatalf("expected hepb template to be protected NIP")
	}
	if tpl, ok := lookupTemplate("pcv13"); !ok || tpl.isProtectedNIP() {
		t.Fatalf("expected pcv13 template not to be protected NIP")
	}
}

// TestMatchTemplateDoseAndBirthHospital 验证标准序号匹配与增删剂次后的月龄回退匹配在视图与产院判断上保持一致。
func TestMatchTemplateDoseAndBirthHospital(t *testing.T) {
	hepb := "hepb"
	flu := "flu"

	birthDose := DoseRecord{
		TemplateCode: &hepb,
		DoseNumber:   1,
		TotalDoses:   3,
		Category:     CategoryNIP,
		AgeMonths:    0,
	}
	if !birthDose.isBirthHospitalDose() {
		t.Fatalf("expected standard HepB dose #1 to be birth-hospital dose")
	}

	// 若总数与模板长度不一致（例如自定义/删减后的模板），应按月龄回退而非误按序号命中第 1 剂。
	nonBirthByAge := DoseRecord{
		TemplateCode: &hepb,
		DoseNumber:   1,
		TotalDoses:   2,
		Category:     CategoryNIP,
		AgeMonths:    1,
	}
	if nonBirthByAge.isBirthHospitalDose() {
		t.Fatalf("expected age-fallback dose (1m) not to be treated as birth-hospital dose")
	}

	// 流感模板删减为 1 剂且保留 7 月龄时，应通过月龄回退命中原第 2 剂的提示文案。
	trimmedFlu := DoseRecord{
		TemplateCode: &flu,
		DoseNumber:   1,
		TotalDoses:   1,
		Category:     CategoryOptional,
		AgeMonths:    7,
	}
	_, matched, ok := matchTemplateDose(trimmedFlu)
	if !ok || matched == nil || matched.DoseNumber != 2 {
		t.Fatalf("expected flu 7m fallback to match template dose #2, got ok=%v matched=%+v", ok, matched)
	}
}

// TestApplySingleUpdateTransitions 验证单剂三态流转的废弃列清空语义及内置 NIP 适龄月龄锁定规则。
func TestApplySingleUpdateTransitions(t *testing.T) {
	hepb := "hepb"
	pcv := "pcv13"

	// 1. 内置 NIP 从 completed 回退至 pending：清空预约/门诊/接种细节，且拒绝修改适龄月龄。
	nipDose := DoseRecord{
		TemplateCode:  &hepb,
		Category:      CategoryNIP,
		AgeMonths:     1,
		AgeLabel:      "1月龄",
		Status:        StatusCompleted,
		ScheduledDate: strPtr("2026-02-20"),
		ScheduledTime: strPtr("09:00"),
		ClinicName:    "城东社区卫生服务中心",
		VaccinatedAt:  strPtr("2026-02-20"),
		Site:          "左上臂",
		Manufacturer:  "康泰",
		BatchNo:       "B202601",
		Reaction:      "无异常",
	}
	nipDose.applySingleUpdate(UpdateDoseInput{
		Status:      StatusPending,
		AgeMonths:   intPtr(3),
		PlannedDate: strPtr("2026-03-01"),
		Note:        "延后接种",
	}, "2026-03-01T00:00:00Z")

	if nipDose.AgeMonths != 1 || nipDose.AgeLabel != "1月龄" {
		t.Fatalf("expected protected NIP age_months to remain 1/1月龄, got %d/%s", nipDose.AgeMonths, nipDose.AgeLabel)
	}
	if nipDose.Status != StatusPending || nipDose.ScheduledDate != nil || nipDose.ScheduledTime != nil ||
		nipDose.ClinicName != "" || nipDose.VaccinatedAt != nil || nipDose.Site != "" ||
		nipDose.Manufacturer != "" || nipDose.BatchNo != "" || nipDose.Reaction != "" {
		t.Fatalf("expected pending transition to clear schedule, clinic and completion fields, got %+v", nipDose)
	}
	if nipDose.PlannedDate == nil || *nipDose.PlannedDate != "2026-03-01" || nipDose.Note != "延后接种" {
		t.Fatalf("expected planned_date and note preserved, got %+v", nipDose)
	}

	// 2. 自费模板切换至 scheduled：允许修改月龄并清空接种细节；月龄不变时保留自定义阶段文案。
	optDose := DoseRecord{
		TemplateCode: &pcv,
		Category:     CategoryOptional,
		AgeMonths:    2,
		AgeLabel:     "定制文案",
		Status:       StatusCompleted,
		VaccinatedAt: strPtr("2026-03-10"),
		Site:         "大腿前外侧",
		Manufacturer: "辉瑞",
		BatchNo:      "PF01",
		Reaction:     "轻微红肿",
	}
	optDose.applySingleUpdate(UpdateDoseInput{
		Status:        StatusScheduled,
		AgeMonths:     intPtr(2),
		ScheduledDate: strPtr("2026-03-20"),
		ScheduledTime: strPtr("10:30"),
		ClinicName:    "妇幼保健院",
	}, "2026-03-15T00:00:00Z")

	if optDose.AgeLabel != "定制文案" {
		t.Fatalf("expected unchanged age_months to preserve custom age_label, got %q", optDose.AgeLabel)
	}
	if optDose.VaccinatedAt != nil || optDose.Site != "" || optDose.Manufacturer != "" || optDose.BatchNo != "" || optDose.Reaction != "" {
		t.Fatalf("expected scheduled transition to clear completion fields, got %+v", optDose)
	}

	optDose.applySingleUpdate(UpdateDoseInput{
		Status:       StatusCompleted,
		AgeMonths:    intPtr(3),
		VaccinatedAt: strPtr("2026-03-21"),
		ClinicName:   "妇幼保健院",
		Site:         "右上臂",
	}, "2026-03-21T00:00:00Z")

	if optDose.AgeMonths != 3 || optDose.AgeLabel != "3月龄" {
		t.Fatalf("expected optional dose age updated to 3/3月龄, got %d/%s", optDose.AgeMonths, optDose.AgeLabel)
	}
	if optDose.ScheduledDate != nil || optDose.ScheduledTime != nil || optDose.VaccinatedAt == nil || *optDose.VaccinatedAt != "2026-03-21" {
		t.Fatalf("expected completed transition to clear schedule fields and write vaccinated_at, got %+v", optDose)
	}
}

// TestApplyBatchUpdateTransitions 验证批量预约清空接种细节、批量完成保留已有接种细节以及 *string 三态语义。
func TestApplyBatchUpdateTransitions(t *testing.T) {
	base := DoseRecord{
		Status:        StatusScheduled,
		PlannedDate:   strPtr("2026-03-15"),
		ScheduledDate: strPtr("2026-03-16"),
		ScheduledTime: strPtr("09:00"),
		ClinicName:    "原社区医院",
		Site:          "左上臂",
		Manufacturer:  "科兴",
		BatchNo:       "BATCH-1",
		Reaction:      "无反应",
		Note:          "原备注",
	}

	// 批量标记已接种：清空预约字段、保留已有接种细节，nil ClinicName 保留原门诊，空串 Note 显式清空。
	completed := base
	completed.applyBatchUpdate(BatchUpdateInput{
		Action:       BatchActionComplete,
		VaccinatedAt: strPtr("2026-03-16"),
		ClinicName:   nil,
		Note:         strPtr(""),
	}, "2026-03-16T08:00:00Z")

	if completed.Status != StatusCompleted || completed.ScheduledDate != nil || completed.ScheduledTime != nil {
		t.Fatalf("expected batch complete to clear schedule fields, got %+v", completed)
	}
	if completed.Site != "左上臂" || completed.Manufacturer != "科兴" || completed.BatchNo != "BATCH-1" || completed.Reaction != "无反应" {
		t.Fatalf("expected batch complete to preserve existing completion details, got %+v", completed)
	}
	if completed.ClinicName != "原社区医院" || completed.Note != "" {
		t.Fatalf("expected nil clinic preserved and empty-string note cleared, got clinic=%q note=%q", completed.ClinicName, completed.Note)
	}

	// 批量预约：清空接种细节，保留 PlannedDate。
	scheduled := completed
	scheduled.applyBatchUpdate(BatchUpdateInput{
		Action:        BatchActionSchedule,
		ScheduledDate: strPtr("2026-04-01"),
		ScheduledTime: strPtr("14:00"),
		ClinicName:    strPtr("新门诊"),
		Note:          nil,
	}, "2026-03-20T08:00:00Z")

	if scheduled.Status != StatusScheduled || scheduled.VaccinatedAt != nil || scheduled.Site != "" ||
		scheduled.Manufacturer != "" || scheduled.BatchNo != "" || scheduled.Reaction != "" {
		t.Fatalf("expected batch schedule to clear completion details, got %+v", scheduled)
	}
	if scheduled.PlannedDate == nil || *scheduled.PlannedDate != "2026-03-15" || scheduled.ClinicName != "新门诊" {
		t.Fatalf("expected planned_date preserved and clinic updated, got %+v", scheduled)
	}
}
