package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

func findDoseViewByID(doses []vaccines.DoseView, id int64) *vaccines.DoseView {
	for i := range doses {
		if doses[i].ID == id {
			return &doses[i]
		}
	}
	return nil
}

func findDoseViewByTemplate(doses []vaccines.DoseView, code string, doseNum int) *vaccines.DoseView {
	for i := range doses {
		if doses[i].TemplateCode != nil && *doses[i].TemplateCode == code && doses[i].DoseNumber == doseNum {
			return &doses[i]
		}
	}
	return nil
}

/*
 * Spec: vaccine-management / Idempotent NIP schedule initialization and overview retrieval / Auto-seed NIP baseline on first retrieval; Compute effective due dates with month-end clamping
 * Spec: vaccine-management / Derived reminder states and birth vaccine quick-confirm eligibility / Derive due_soon and overdue states for pending doses; Report birth hospital vaccines pending for explicit user confirmation
 * 测试场景：首次幂等初始化 22 剂 NIP 与产院两针待确认提示、月末出生（1/31→2/28）日期钳位，以及经时钟推进完整演进全部 7 种派生提醒状态与下一步焦点合并优先级。
 * 业务背景：疫苗提醒状态完全按当前本地日期实时派生而不落库；通过可控时钟模拟预约临近、预约过期到补打完成的全流程，可一次性验证 7 态边界与焦点卡合并规则。
 * 前置数据：
 * - 时钟与时区：初始 2026-06-15 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：小汤圆（出生日期 2026-01-31，用于检验 1 月龄钳位至 2026-02-28）
 * - 前置业务记录：步骤 1 懒初始化 22 剂 NIP；步骤 2–3 新增自定义剂次并预约同日两剂演进时钟
 * 测试目标：
 * 1. 验证首次 GET /api/babies/:babyId/vaccines 幂等落库 22 剂 NIP、上报产院两针 pending 与免责声明，且乙肝第 2 剂 effective_date 钳位为 2026-02-28。
 * 2. 验证 2026-06-15 当天待接种剂次按 planned_date 分别派生为 overdue、due_soon 与 upcoming。
 * 3. 验证预约同日两剂（首剂省略门诊/时间、次剂携带门诊与 09:30）随 FakeClock 推进依次演进为 scheduled → scheduled_soon → scheduled_overdue → completed，且 next_focus 优先级高于 overdue 并自动合并同日两剂与补齐门诊时间。
 */
func TestVaccinesSeedClampingAndSevenAlertStates(t *testing.T) {
	t.Parallel()

	// 固定时钟在 2026-06-15 10:00:00+08:00（UTC 02:00）。
	app := NewTestApp(t, WithClock(time.Date(2026, 6, 15, 2, 0, 0, 0, time.UTC)))
	s := app.Scenario()
	s.EnsureBaby(BabyParams{BirthDate: "2026-01-31"})

	// 1. 首次读取自动落库 22 剂 NIP 并上报产院两针待确认，二次读取保持幂等；同步核对 1/31→2/28 月底钳位。
	ov1 := s.SeedVaccines("Asia/Shanghai")
	if len(ov1.Doses) != 22 || ov1.Summary.NIPTotal != 22 ||
		!ov1.Summary.BirthConfirmPending || len(ov1.Summary.BirthPendingDoseIDs) != 2 ||
		ov1.Disclaimer == "" || ov1.DefaultClinicName != "" {
		t.Fatalf("首次疫苗总览初始化异常：total=%d summary=%+v clinic=%q",
			len(ov1.Doses), ov1.Summary, ov1.DefaultClinicName)
	}
	if got := CountRows[vaccines.DoseRecord](t, app, ""); got != 22 {
		t.Fatalf("SQLite 预期落库 22 剂 NIP，实际 %d", got)
	}
	ov2 := s.SeedVaccines("Asia/Shanghai")
	if len(ov2.Doses) != 22 || CountRows[vaccines.DoseRecord](t, app, "") != 22 {
		t.Fatalf("二次读取应保持 22 剂幂等不重复，实际 %d", len(ov2.Doses))
	}

	hepb2 := findDoseViewByTemplate(ov1.Doses, "hepb", 2)
	if hepb2 == nil || hepb2.DefaultDueDate != "2026-02-28" || hepb2.EffectiveDate != "2026-02-28" {
		t.Fatalf("1 月 31 日出生宝宝乙肝第 2 剂应钳位至 2026-02-28，实际 %+v", hepb2)
	}

	// 2. 创建 3 剂带明确 planned_date 的待接种疫苗，验证 pending 系的 overdue / due_soon / upcoming 三态。
	custom := s.AddCustomVaccine(vaccines.CreateCustomInput{
		VaccineName: "七态演进测试疫苗",
		Category:    vaccines.CategoryOptional,
		Doses: []vaccines.DosePlanInput{
			{AgeMonths: 4, PlannedDate: ptr("2026-05-20")}, // 逾期 26 天 → overdue
			{AgeMonths: 5, PlannedDate: ptr("2026-06-25")}, // 距预计日 +10 天 → due_soon
			{AgeMonths: 6, PlannedDate: ptr("2026-07-10")}, // 距预计日 +25 天 → upcoming
		},
	})
	if len(custom) != 3 ||
		custom[0].AlertState != vaccines.AlertOverdue ||
		custom[1].AlertState != vaccines.AlertDueSoon ||
		custom[2].AlertState != vaccines.AlertUpcoming {
		t.Fatalf("pending 三态派生不符合预期：[0]=%s [1]=%s [2]=%s",
			custom[0].AlertState, custom[1].AlertState, custom[2].AlertState)
	}

	// 3. 预约同日两剂（2026-06-25）：首剂无门诊与时间，次剂带门诊与 09:30；推进时钟依次验证 scheduled / scheduled_soon / scheduled_overdue / completed 及焦点合并。
	booked1 := s.UpdateVaccineDose(custom[1].ID, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-06-25"),
	})
	booked2 := s.UpdateVaccineDose(custom[2].ID, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-06-25"),
		ScheduledTime: ptr("09:30"),
		ClinicName:    "城东社区卫生服务中心",
	})
	if booked1.AlertState != vaccines.AlertScheduled || booked2.AlertState != vaccines.AlertScheduled {
		t.Fatalf("距离预约日 10 天时应处于 scheduled 态，实际 booked1=%s booked2=%s", booked1.AlertState, booked2.AlertState)
	}

	// 推进 5 天至 2026-06-20（距 06-25 为 5 天，进入 7 天内 scheduled_soon 窗口），焦点优先级应压过既有 overdue 剂次并合并同日两剂。
	app.Clock.Advance(5 * 24 * time.Hour)
	ovSoon := s.GetVaccinesOverview("Asia/Shanghai")
	if ovSoon.Summary.ScheduledSoonCount != 2 || ovSoon.Summary.NextFocus == nil ||
		ovSoon.Summary.NextFocus.Kind != vaccines.AlertScheduledSoon ||
		len(ovSoon.Summary.NextFocus.DoseIDs) != 2 ||
		ovSoon.Summary.NextFocus.ClinicName != "城东社区卫生服务中心" ||
		ovSoon.Summary.NextFocus.ScheduledTime != "09:30" {
		t.Fatalf("推进至预约前 5 天时预期 scheduled_soon 合并焦点且补齐门诊时间，实际 summary=%+v focus=%+v",
			ovSoon.Summary, ovSoon.Summary.NextFocus)
	}

	// 再推进 6 天至 2026-06-26（已累计推进 11 天，超出 7 天会话有效期，需按真实家长操作重新登录），预约剂次转为最高优先级 scheduled_overdue。
	app.Clock.Advance(6 * 24 * time.Hour)
	app.Relogin()
	ovOverdue := s.GetVaccinesOverview("Asia/Shanghai")
	if ovOverdue.Summary.ScheduledOverdueCount != 2 || ovOverdue.Summary.NextFocus == nil ||
		ovOverdue.Summary.NextFocus.Kind != vaccines.AlertScheduledOverdue {
		t.Fatalf("越过预约日后预期进入 scheduled_overdue 最高焦点，实际 summary=%+v focus=%+v",
			ovOverdue.Summary, ovOverdue.Summary.NextFocus)
	}

	// 补打完成第 1 剂，验证进入 completed 终态且回读疫苗总览计数同步更新。
	done := s.UpdateVaccineDose(custom[1].ID, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: ptr("2026-06-26"),
		ClinicName:   "城东社区卫生服务中心",
	})
	if done.AlertState != vaccines.AlertCompleted {
		t.Fatalf("补打完成后预期 alert_state=completed，实际 %s", done.AlertState)
	}
	ovCompleted := s.GetVaccinesOverview("Asia/Shanghai")
	if ovCompleted.Summary.OptionalCompleted != 1 || ovCompleted.Summary.ScheduledOverdueCount != 1 {
		t.Fatalf("补打完成后总览计数应同步更新（optional_completed=1, scheduled_overdue=1），实际 %+v", ovCompleted.Summary)
	}
}

/*
 * Spec: vaccine-management / Optional vaccine catalog and custom vaccine dose creation / Add an optional vaccine template once with default or customized doses; Create a custom vaccine series; Reject invalid custom vaccine payload
 * Spec: vaccine-management / Dose status transitions and record updates
 * Spec: vaccine-management / Controlled deletion, automatic renumbering, and template removal / Delete a middle dose and renumber subsequent siblings; Remove an entire optional template series; Reject deletion of built-in NIP dose
 * 测试场景：自费疫苗模板默认与定制导入、重复 409、流感定制文案、单剂调整月龄契约（自费重算 vs NIP 保护）、删中间剂重排、整套移出及 400/404 负向防线。
 * 业务背景：家长既可按默认排期快速加入自费模板，也可按当地门诊方案定制月龄与剂数，并允许删减自费/自定义剂次后自动重排编号，但严禁篡改内置 NIP 月龄或误删内置 NIP 剂次。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：已初始化 22 剂内置 NIP 基线
 * 测试目标：
 * 1. 验证自费目录返回 5 套模板；按默认排期导入 rv5 与定制 3 剂导入 pcv13 均返回 201，重复导入 pcv13 返回 409；flu 同月龄更新保留定制阶段文案。
 * 2. 验证修改自费剂次 age_months 同步重算 age_label 与 default_due_date，而向内置 NIP 剂次传入 age_months 静默保持原月龄不变。
 * 3. 验证删除 pcv13 与自定义疫苗的中间第 2 剂后，SQLite 剩余兄弟剂次连续重排为 1/2、2/2；整套移出 pcv13 或逐剂删光 rv5 后目录恢复 added=false 且支持重新导入。
 * 4. 验证删除内置 NIP 单剂/模板与导入未知/NIP 模板返回 400，未知剂次/未加入模板操作返回 404，非法自定义载荷返回 400 且总行数不变。
 */
func TestVaccinesOptionalTemplatesCustomAndDeletion(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	vacBase := babyPath(b.ID, "/vaccines")
	ov := s.SeedVaccines()
	client := app.Client()

	fetchCatalog := func() vaccines.CatalogResponse {
		t.Helper()
		resp := client.Get(t, vacBase+"/catalog")
		resp.RequireStatus(t, http.StatusOK)
		return DecodeOK[vaccines.CatalogResponse](t, resp)
	}

	// 1. 核对 5 套自费目录，分别验证默认排期导入（rv5 五价轮状）、定制排期导入（pcv13）、重复导入 409 及 flu 定制文案保留。
	cat := fetchCatalog()
	if len(cat.Templates) != 5 || len(cat.Templates[0].Doses) == 0 {
		t.Fatalf("自费目录预期 5 套模板且含默认剂次明细，实际 %+v", cat.Templates)
	}

	rv5 := s.AddVaccineTemplate("rv5")
	if len(rv5) != 3 || rv5[0].DoseNumber != 1 || rv5[0].TotalDoses != 3 {
		t.Fatalf("按默认排期导入 rv5 预期 3 剂，实际 %+v", rv5)
	}

	pcv := s.AddVaccineTemplate("pcv13", 7, 9, 12)
	if len(pcv) != 3 || pcv[1].DoseNumber != 2 || pcv[1].TotalDoses != 3 || pcv[1].AgeMonths != 9 {
		t.Fatalf("定制导入 3 剂 pcv13 返回异常：%+v", pcv)
	}
	cat = fetchCatalog()
	var pcvItem *vaccines.CatalogItem
	for i := range cat.Templates {
		if cat.Templates[i].Code == "pcv13" {
			pcvItem = &cat.Templates[i]
		}
	}
	if pcvItem == nil || !pcvItem.Added || pcvItem.AddedDoseCount != 3 {
		t.Fatalf("目录中 pcv13 预期 added=true 且剂次数 3，实际 %+v", pcvItem)
	}
	client.Post(t, vacBase+"/from-template?tz=Asia/Shanghai", vaccines.AddTemplateInput{
		TemplateCode: "pcv13",
	}).RequireError(t, http.StatusConflict, "")

	flu := s.AddVaccineTemplate("flu", 6, 7)
	if len(flu) != 2 || flu[0].AgeLabel != "6月龄起" || flu[1].AgeLabel != "首季第2剂" {
		t.Fatalf("flu 定制阶段文案未保留：%+v", flu)
	}
	sameMonthFlu := s.UpdateVaccineDose(flu[0].ID, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		AgeMonths:     ptr(6),
		ScheduledDate: ptr("2026-12-01"),
	})
	if sameMonthFlu.AgeLabel != "6月龄起" {
		t.Fatalf("同月龄更新 flu 不应覆盖定制阶段文案，实际 %q", sameMonthFlu.AgeLabel)
	}

	// 2. 验证单剂调整适龄月龄契约：自费剂次真正改月龄重算标签与默认日期，内置 NIP 传入 age_months 静默保持原月龄。
	changedFlu := s.UpdateVaccineDose(flu[0].ID, vaccines.UpdateDoseInput{
		Status:    vaccines.StatusPending,
		AgeMonths: ptr(8),
	})
	if changedFlu.AgeMonths != 8 || changedFlu.AgeLabel != "8月龄" || changedFlu.DefaultDueDate != "2027-03-15" {
		t.Fatalf("自费剂次修改月龄为 8 后预期 8月龄/2027-03-15，实际 %+v", changedFlu)
	}
	hepb2 := findDoseViewByTemplate(ov.Doses, "hepb", 2)
	if hepb2 == nil {
		t.Fatalf("未找到内置乙肝第 2 剂")
	}
	keptNIP := s.UpdateVaccineDose(hepb2.ID, vaccines.UpdateDoseInput{
		Status:    vaccines.StatusPending,
		AgeMonths: ptr(12),
	})
	if keptNIP.AgeMonths != 1 {
		t.Fatalf("内置 NIP 剂次不得被修改适龄月龄，预期仍为 1，实际 %d", keptNIP.AgeMonths)
	}

	// 3. 删除中间剂次验证剩余兄弟自动连续重排，整套移出或逐剂删光模板后目录恢复未加入且允许重新导入。
	client.Delete(t, fmt.Sprintf("%s/%d", vacBase, pcv[1].ID)).RequireStatus(t, http.StatusOK)
	pcvRows := FindRows[vaccines.DoseRecord](t, app, "dose_number ASC", "template_code = ?", "pcv13")
	if len(pcvRows) != 2 || pcvRows[0].DoseNumber != 1 || pcvRows[0].TotalDoses != 2 || pcvRows[0].AgeMonths != 7 ||
		pcvRows[1].DoseNumber != 2 || pcvRows[1].TotalDoses != 2 || pcvRows[1].AgeMonths != 12 {
		t.Fatalf("删除 pcv13 第 2 剂后剩余重排异常：%+v", pcvRows)
	}

	client.Delete(t, vacBase+"/template/pcv13").RequireStatus(t, http.StatusOK)
	if got := CountRows[vaccines.DoseRecord](t, app, "template_code = ?", "pcv13"); got != 0 {
		t.Fatalf("整套移出 pcv13 后 SQLite 仍有残留行：%d", got)
	}
	cat = fetchCatalog()
	for _, tpl := range cat.Templates {
		if tpl.Code == "pcv13" && tpl.Added {
			t.Fatalf("整套移出 pcv13 后目录应恢复 added=false")
		}
	}

	// 逐剂删光 rv5 全部 3 剂至最后一剂，验证目录恢复 added=false 且支持重新导入。
	for _, d := range rv5 {
		client.Delete(t, fmt.Sprintf("%s/%d", vacBase, d.ID)).RequireStatus(t, http.StatusOK)
	}
	if got := CountRows[vaccines.DoseRecord](t, app, "template_code = ?", "rv5"); got != 0 {
		t.Fatalf("逐剂删光 rv5 后 SQLite 应归零，实际 %d", got)
	}
	cat = fetchCatalog()
	for _, tpl := range cat.Templates {
		if tpl.Code == "rv5" && (tpl.Added || tpl.AddedDoseCount != 0) {
			t.Fatalf("逐剂删光 rv5 后目录应恢复未加入：%+v", tpl)
		}
	}
	if reAdded := s.AddVaccineTemplate("rv5"); len(reAdded) != 3 {
		t.Fatalf("删光后重新导入 rv5 预期返回 3 剂，实际 %d", len(reAdded))
	}

	custom := s.AddCustomVaccine(vaccines.CreateCustomInput{
		VaccineName: "五联疫苗",
		Category:    vaccines.CategoryOptional,
		Note:        "社区门诊通知",
		Doses: []vaccines.DosePlanInput{
			{AgeMonths: 2},
			{AgeMonths: 3},
			{AgeMonths: 4},
		},
	})
	if len(custom) != 3 || custom[0].TemplateCode != nil {
		t.Fatalf("自定义多剂疫苗返回异常：%+v", custom)
	}
	client.Delete(t, fmt.Sprintf("%s/%d", vacBase, custom[1].ID)).RequireStatus(t, http.StatusOK)
	customRows := FindRows[vaccines.DoseRecord](t, app, "dose_number ASC", "vaccine_name = ?", "五联疫苗")
	if len(customRows) != 2 || customRows[0].DoseNumber != 1 || customRows[0].TotalDoses != 2 ||
		customRows[1].DoseNumber != 2 || customRows[1].TotalDoses != 2 || customRows[1].AgeMonths != 4 {
		t.Fatalf("自定义疫苗删中间剂后 SQLite 重排异常：%+v", customRows)
	}

	// 4. 负向防线：保护内置 NIP 不被删、拦截非法模板与非法自定义载荷（400）、拦截未知剂次/未加入模板（404）且零脏写。
	nipDoseID := ov.Doses[0].ID
	client.Delete(t, fmt.Sprintf("%s/%d", vacBase, nipDoseID)).RequireError(t, http.StatusBadRequest, "")
	client.Delete(t, vacBase+"/template/hepb").RequireError(t, http.StatusBadRequest, "")
	if got := CountRows[vaccines.DoseRecord](t, app, "id = ?", nipDoseID); got != 1 {
		t.Fatalf("内置 NIP 剂次受保护不得被删除，当前行数 %d", got)
	}

	client.Post(t, vacBase+"/from-template?tz=Asia/Shanghai", vaccines.AddTemplateInput{TemplateCode: "unknown_tpl"}).
		RequireError(t, http.StatusBadRequest, "")
	client.Post(t, vacBase+"/from-template?tz=Asia/Shanghai", vaccines.AddTemplateInput{TemplateCode: "hepb"}).
		RequireError(t, http.StatusBadRequest, "")

	client.Put(t, vacBase+"/999999?tz=Asia/Shanghai", vaccines.UpdateDoseInput{Status: vaccines.StatusPending}).
		RequireError(t, http.StatusNotFound, "")
	client.Delete(t, vacBase+"/999999").RequireError(t, http.StatusNotFound, "")
	client.Delete(t, vacBase+"/template/unknown_tpl").RequireError(t, http.StatusNotFound, "")
	client.Delete(t, vacBase+"/template/ev71").RequireError(t, http.StatusNotFound, "")

	beforeCount := CountRows[vaccines.DoseRecord](t, app, "")
	badDate := "2026/05/01"
	for _, in := range []vaccines.CreateCustomInput{
		{VaccineName: "   ", Category: vaccines.CategoryOptional, Doses: []vaccines.DosePlanInput{{AgeMonths: 2}}},
		{VaccineName: "测试苗", Category: "free", Doses: []vaccines.DosePlanInput{{AgeMonths: 2}}},
		{VaccineName: "测试苗", Category: vaccines.CategoryOptional},
		{VaccineName: "测试苗", Category: vaccines.CategoryOptional, Doses: make([]vaccines.DosePlanInput, vaccines.MaxTotalDoses+1)},
		{VaccineName: "测试苗", Category: vaccines.CategoryOptional, Doses: []vaccines.DosePlanInput{{AgeMonths: vaccines.MaxAgeMonths + 1}}},
		{VaccineName: "测试苗", Category: vaccines.CategoryOptional, Doses: []vaccines.DosePlanInput{{AgeMonths: 2, PlannedDate: &badDate}}},
	} {
		client.Post(t, vacBase+"?tz=Asia/Shanghai", in).RequireError(t, http.StatusBadRequest, "")
	}
	if afterCount := CountRows[vaccines.DoseRecord](t, app, ""); afterCount != beforeCount {
		t.Fatalf("非法自定义载荷被拒后 SQLite 剂次总数应保持 %d，实际 %d", beforeCount, afterCount)
	}
}

/*
 * Spec: vaccine-management / Dose status transitions and record updates / Book an appointment for a pending dose; Record a completed vaccination; Revert a dose back to pending; Reject completion with out-of-bounds vaccination date
 * 测试场景：单剂疫苗三态完整流转（pending → scheduled → completed → pending）清零废弃列、常用门诊回显及越界接种日期拒绝。
 * 业务背景：家长预约改期、补录完成或误标后撤销回待接种时，单剂更新必须严格清空上一状态的专属字段，且严禁记录早于出生日或晚于今天的接种日期。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：已初始化 22 剂 NIP 基线，选用乙肝第 2 剂（hepb#2）作为被测对象
 * 测试目标：
 * 1. 验证 pending → scheduled 后 SQLite 落库预约日期/时间且 vaccinated_at 为 NULL。
 * 2. 验证晚于今天（2026-11-24）与早于出生日（2020-01-01）的接种完成请求返回 400 且不破坏既有预约态。
 * 3. 验证 scheduled → completed 清空预约列并更新 recent_clinics；completed → scheduled 清空旧接种详情列；回退 pending 全清空，并核对多门诊演进下 recent_clinics 最近优先去重截断至 Top-3。
 */
func TestVaccinesSingleDoseTransitionsAndValidation(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	ov := s.SeedVaccines()
	client := app.Client()

	hepb2 := findDoseViewByTemplate(ov.Doses, "hepb", 2)
	if hepb2 == nil {
		t.Fatalf("未找到内置乙肝第 2 剂")
	}
	endpoint := babyPath(b.ID, fmt.Sprintf("/vaccines/%d?tz=Asia/Shanghai", hepb2.ID))

	// 1. pending → scheduled，回读 SQLite 确认预约列落库且 vaccinated_at 为 NULL。
	client.Put(t, endpoint, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-28"),
		ScheduledTime: ptr("09:30"),
		ClinicName:    "城西社区卫生服务中心",
		Note:          "提前 10 分钟取号",
	}).RequireStatus(t, http.StatusOK)
	row := FirstRow[vaccines.DoseRecord](t, app, "id = ?", hepb2.ID)
	if row.Status != vaccines.StatusScheduled || row.ScheduledDate == nil || *row.ScheduledDate != "2026-11-28" ||
		row.ScheduledTime == nil || *row.ScheduledTime != "09:30" || row.VaccinatedAt != nil {
		t.Fatalf("预约后 SQLite 落库异常：%+v", row)
	}

	// 2. 拒绝未来日期与早于出生日的完成接种请求，并确认既有预约状态未被破坏。
	client.Put(t, endpoint, vaccines.UpdateDoseInput{
		Status: vaccines.StatusCompleted, VaccinatedAt: ptr("2026-11-24"),
	}).RequireError(t, http.StatusBadRequest, "不能晚于今天")
	client.Put(t, endpoint, vaccines.UpdateDoseInput{
		Status: vaccines.StatusCompleted, VaccinatedAt: ptr("2020-01-01"),
	}).RequireError(t, http.StatusBadRequest, "不能早于宝宝出生日期")
	if check := FirstRow[vaccines.DoseRecord](t, app, "id = ?", hepb2.ID); check.Status != vaccines.StatusScheduled {
		t.Fatalf("越界日期拒绝后原预约态不应被修改：%+v", check)
	}

	// 3. scheduled → completed 清空预约列并同步 recent_clinics；再 completed → scheduled 实测清空旧接种细节列；最后回退 pending 全清空。
	client.Put(t, endpoint, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: ptr("2026-11-23"),
		ClinicName:   "城西社区卫生服务中心",
		Site:         "右上臂",
		Manufacturer: "沃森生物",
		BatchNo:      "P202611",
		Reaction:     "轻微嗜睡",
	}).RequireStatus(t, http.StatusOK)
	row = FirstRow[vaccines.DoseRecord](t, app, "id = ?", hepb2.ID)
	if row.Status != vaccines.StatusCompleted || row.ScheduledDate != nil || row.ScheduledTime != nil ||
		row.VaccinatedAt == nil || *row.VaccinatedAt != "2026-11-23" || row.Site != "右上臂" {
		t.Fatalf("完成后 SQLite 落库异常：%+v", row)
	}
	if ovAfter := s.GetVaccinesOverview(); !slices.Contains(ovAfter.RecentClinics, "城西社区卫生服务中心") {
		t.Fatalf("recent_clinics 应包含城西社区卫生服务中心，实际 %v", ovAfter.RecentClinics)
	}

	client.Put(t, endpoint, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-30"),
		ScheduledTime: ptr("10:00"),
		ClinicName:    "城西社区卫生服务中心",
	}).RequireStatus(t, http.StatusOK)
	row = FirstRow[vaccines.DoseRecord](t, app, "id = ?", hepb2.ID)
	if row.Status != vaccines.StatusScheduled || row.ScheduledDate == nil || *row.ScheduledDate != "2026-11-30" ||
		row.VaccinatedAt != nil || row.Site != "" || row.Manufacturer != "" ||
		row.BatchNo != "" || row.Reaction != "" {
		t.Fatalf("从 completed 切回 scheduled 后旧接种细节列未清空：%+v", row)
	}

	client.Put(t, endpoint, vaccines.UpdateDoseInput{
		Status: vaccines.StatusPending,
	}).RequireStatus(t, http.StatusOK)
	row = FirstRow[vaccines.DoseRecord](t, app, "id = ?", hepb2.ID)
	if row.Status != vaccines.StatusPending || row.ScheduledDate != nil || row.ScheduledTime != nil ||
		row.VaccinatedAt != nil || row.Site != "" || row.Manufacturer != "" ||
		row.BatchNo != "" || row.Reaction != "" || row.ClinicName != "" {
		t.Fatalf("回退 pending 后预约与接种字段未全部清空：%+v", row)
	}

	// 依次在 4 个不同门诊推进时钟预约不同剂次并复访最早门诊，验证 recent_clinics 按最近优先去重并截断至 Top-3。
	polio1 := findDoseViewByTemplate(ov.Doses, "polio", 1)
	dtap1 := findDoseViewByTemplate(ov.Doses, "dtap", 1)
	hepb3 := findDoseViewByTemplate(ov.Doses, "hepb", 3)
	polio2 := findDoseViewByTemplate(ov.Doses, "polio", 2)
	if polio1 == nil || dtap1 == nil || hepb3 == nil || polio2 == nil {
		t.Fatalf("缺少内置 NIP 测试剂次")
	}
	visits := []struct {
		doseID int64
		clinic string
	}{
		{hepb2.ID, "第一社区门诊"},
		{polio1.ID, "第二社区门诊"},
		{dtap1.ID, "第三社区门诊"},
		{hepb3.ID, "第四社区门诊"},
		{polio2.ID, "第一社区门诊"},
	}
	for _, v := range visits {
		app.Clock.Advance(time.Minute)
		s.UpdateVaccineDose(v.doseID, vaccines.UpdateDoseInput{
			Status:        vaccines.StatusScheduled,
			ScheduledDate: ptr("2026-12-01"),
			ClinicName:    v.clinic,
		})
	}
	wantRecent := []string{"第一社区门诊", "第四社区门诊", "第三社区门诊"}
	if gotRecent := s.GetVaccinesOverview().RecentClinics; !slices.Equal(gotRecent, wantRecent) {
		t.Fatalf("recent_clinics 预期按最近优先去重截断为 %v，实际 %v", wantRecent, gotRecent)
	}
}

/*
 * Spec: vaccine-management / Batch appointment booking and historical completion / Batch-mark multiple same-stage doses as completed; Roll back batch update when any dose ID is invalid; Batch update rolls back default clinic change on invalid dose ID
 * 测试场景：批量确认产院两针不污染常去门诊、批量三态字段保留/清空、批量完成保留单剂细节 vs 批量预约清空细节，以及含非法 ID 整事务原子回滚。
 * 业务背景：批量操作与单剂更新存在关键语义差异——批量完成刻意保留各剂已填部位/厂家/批号/反应，而批量预约必须清空它们；且批量请求中混入任意不存在 ID 时须完整回滚包括默认门诊在内的所有改动。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female，常去门诊为空）
 * - 前置业务记录：已初始化 22 剂 NIP 基线
 * 测试目标：
 * 1. 验证批量完成产院两针清除 birth_confirm_pending、更新进度与 recent_clinics，同时不把产院名称写入宝宝空默认门诊。
 * 2. 验证批量三态字段（nil 保留、"" 清空），并核对批量完成保留单剂已填 site/manufacturer/batch_no/reaction、批量预约则将其清空。
 * 3. 验证批量请求含不存在 ID 且携带 set_default_clinic=true 返回 404，SQLite 确认合法剂次与宝宝常去门诊均完整回滚未改。
 */
func TestVaccinesBatchOperationsAtomicityAndDetailSemantics(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	profile := s.EnsureBaby()
	batchURL := babyPath(profile.ID, "/vaccines/batch?tz=Asia/Shanghai")
	ov := s.SeedVaccines()
	client := app.Client()

	// 1. 批量完成产院两针：清除产院确认横幅并记录 recent_clinics，但不污染宝宝常去社区门诊。
	client.Post(t, batchURL, vaccines.BatchUpdateInput{
		Action:       vaccines.BatchActionComplete,
		DoseIDs:      ov.Summary.BirthPendingDoseIDs,
		VaccinatedAt: ptr(profile.BirthDate),
		ClinicName:   ptr("妇幼保健院产科"),
	}).RequireStatus(t, http.StatusOK)

	ovAfterBirth := s.GetVaccinesOverview()
	if ovAfterBirth.Summary.BirthConfirmPending || ovAfterBirth.Summary.NIPCompleted != 2 ||
		!slices.Contains(ovAfterBirth.RecentClinics, "妇幼保健院产科") {
		t.Fatalf("批量确认产院两针后总览状态异常：summary=%+v clinics=%v",
			ovAfterBirth.Summary, ovAfterBirth.RecentClinics)
	}
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "" {
		t.Fatalf("纯产院批量确认不得自动污染常去门诊，实际 %q", got)
	}

	// 2. 验证批量三态语义，并对比“批量完成保留既有接种细节”与“批量预约清空接种细节”的隐性契约。
	polio1 := findDoseViewByTemplate(ovAfterBirth.Doses, "polio", 1)
	if polio1 == nil {
		t.Fatalf("未找到脊灰第 1 剂")
	}
	// 先通过单剂更新写入完整接种细节（部位/厂家/批号/反应）与门诊备注。
	s.UpdateVaccineDose(polio1.ID, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: ptr("2026-11-20"),
		ClinicName:   "阳光街道社区卫生服务中心",
		Site:         "左大腿",
		Manufacturer: "北京科兴",
		BatchNo:      "K202611",
		Reaction:     "无不良反应",
		Note:         "需携带接种证",
	})
	// 批量完成仅调整日期并省略 clinic_name/note：核对原有门诊、备注及四项接种细节全部保留。
	client.Post(t, batchURL, vaccines.BatchUpdateInput{
		Action:       vaccines.BatchActionComplete,
		DoseIDs:      []int64{polio1.ID},
		VaccinatedAt: ptr("2026-11-21"),
	}).RequireStatus(t, http.StatusOK)
	polioRow := FirstRow[vaccines.DoseRecord](t, app, "id = ?", polio1.ID)
	if polioRow.VaccinatedAt == nil || *polioRow.VaccinatedAt != "2026-11-21" ||
		polioRow.ClinicName != "阳光街道社区卫生服务中心" || polioRow.Note != "需携带接种证" ||
		polioRow.Site != "左大腿" || polioRow.Manufacturer != "北京科兴" ||
		polioRow.BatchNo != "K202611" || polioRow.Reaction != "无不良反应" {
		t.Fatalf("批量完成不应覆盖既有门诊、备注或四项接种细节：%+v", polioRow)
	}

	// 批量预约并显式传 clinic_name=""：核对清空门诊与全部接种细节，但保留未传入的 note。
	client.Post(t, batchURL, vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       []int64{polio1.ID},
		ScheduledDate: ptr("2026-11-29"),
		ClinicName:    ptr(""),
	}).RequireStatus(t, http.StatusOK)
	polioRow = FirstRow[vaccines.DoseRecord](t, app, "id = ?", polio1.ID)
	if polioRow.Status != vaccines.StatusScheduled || polioRow.ClinicName != "" || polioRow.Note != "需携带接种证" ||
		polioRow.VaccinatedAt != nil || polioRow.Site != "" || polioRow.Manufacturer != "" ||
		polioRow.BatchNo != "" || polioRow.Reaction != "" {
		t.Fatalf("批量预约应清空门诊与接种细节并保留 note：%+v", polioRow)
	}

	// 3. 批量请求混入不存在 ID 且携带 set_default_clinic=true：返回 404，合法剂次与常去门诊均原子回滚。
	dtap1 := findDoseViewByTemplate(ovAfterBirth.Doses, "dtap", 1)
	if dtap1 == nil {
		t.Fatalf("未找到百白破第 1 剂")
	}
	client.Post(t, batchURL, vaccines.BatchUpdateInput{
		Action:           vaccines.BatchActionComplete,
		DoseIDs:          []int64{dtap1.ID, 999999},
		VaccinatedAt:     ptr("2026-11-23"),
		ClinicName:       ptr("错误回滚医院"),
		SetDefaultClinic: true,
	}).RequireError(t, http.StatusNotFound, "")

	dtapRow := FirstRow[vaccines.DoseRecord](t, app, "id = ?", dtap1.ID)
	if dtapRow.Status != vaccines.StatusPending || dtapRow.VaccinatedAt != nil || dtapRow.ClinicName != "" {
		t.Fatalf("事务回滚后 dtap#1 应保持原 pending 状态：%+v", dtapRow)
	}
	babyRow := FirstRow[baby.Profile](t, app, "id = ?", profile.ID)
	if babyRow.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("事务回滚后常去门诊应仍为阳光街道社区卫生服务中心，实际 %q", babyRow.DefaultClinicName)
	}
}

/*
 * Spec: vaccine-management / Explicit default vaccination clinic management / Set and clear default vaccination clinic; Reject oversized default clinic name
 * Spec: vaccine-management / Dose status transitions and record updates / Auto-remember first non-birth clinic and respect explicit default clinic pin
 * Spec: vaccine-management / Batch appointment booking and historical completion
 * 测试场景：验证常去接种门诊独立接口、单剂自动记住/防产院污染/防偶发覆盖/显式置顶，以及批量常规预约自动记住规则。
 * 业务背景：宝宝通常固定在一家社区医院接种，系统需支持行内直接设置或清空默认门诊，同时在首次常规接种时自动记住，但绝不被产院补录或偶发去儿童医院覆盖。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female，常去门诊为空）
 * - 前置业务记录：已初始化 22 剂 NIP 基线
 * 测试目标：
 * 1. 验证 PUT /api/babies/:babyId/vaccines/default-clinic 裁剪落库并与 GET /api/babies/:babyId/vaccines、GET /api/babies 同步；超 80 字返回 400 且不改库；传 "" 清空。
 * 2. 验证产院出生剂次不污染空默认门诊 → 首次常规剂次自动记住 → 偶发医院不覆盖 → set_default_clinic=true 显式覆写。
 * 3. 验证清空默认门诊后，批量预约 2 月龄常规剂次同样原子自动记住常去门诊。
 */
func TestVaccinesDefaultClinicAndAutoRemember(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	profile := s.EnsureBaby()
	clinicURL := babyPath(profile.ID, "/vaccines/default-clinic")
	batchURL := babyPath(profile.ID, "/vaccines/batch?tz=Asia/Shanghai")
	ov := s.SeedVaccines()
	client := app.Client()

	// 1. 独立接口设置、跨接口同步校验、超长 400 保护与清空。
	setResp := client.Put(t, clinicURL, map[string]string{
		"clinic_name": "  阳光街道社区卫生服务中心  ",
	})
	setResp.RequireStatus(t, http.StatusOK)
	if got := DecodeOK[struct {
		DefaultClinicName string `json:"default_clinic_name"`
	}](t, setResp).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("设置默认门诊返回异常：%q", got)
	}
	if s.GetVaccinesOverview().DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("GET /api/babies/:babyId/vaccines 未同步返回常去门诊")
	}
	babiesResp := client.Get(t, "/api/babies")
	babiesResp.RequireStatus(t, http.StatusOK)
	gotBabies := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, babiesResp).Babies
	if len(gotBabies) != 1 || gotBabies[0].DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("GET /api/babies 未同步返回常去门诊：%+v", gotBabies)
	}

	client.Put(t, clinicURL, map[string]string{
		"clinic_name": strings.Repeat("院", baby.MaxClinicNameLength+1),
	}).RequireError(t, http.StatusBadRequest, "80")
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("超长 400 后不应改动已落库常去门诊：%q", got)
	}

	client.Put(t, clinicURL, map[string]string{"clinic_name": ""}).RequireStatus(t, http.StatusOK)
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "" {
		t.Fatalf("清空后 SQLite 常去门诊应为空串，实际 %q", got)
	}

	// 2. 单剂自动记住链：产院不污染 → 首次常规自动记住 → 偶发不覆盖 → 显式置顶覆写。
	hepb1 := findDoseViewByTemplate(ov.Doses, "hepb", 1)
	hepb2 := findDoseViewByTemplate(ov.Doses, "hepb", 2)
	polio1 := findDoseViewByTemplate(ov.Doses, "polio", 1)
	dtap1 := findDoseViewByTemplate(ov.Doses, "dtap", 1)
	if hepb1 == nil || hepb2 == nil || polio1 == nil || dtap1 == nil {
		t.Fatalf("缺少预期的内置 NIP 基础剂次")
	}

	s.UpdateVaccineDose(hepb1.ID, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: ptr(profile.BirthDate),
		ClinicName:   "市妇幼保健院",
	})
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "" {
		t.Fatalf("产院出生剂次不得自动记住为常去门诊，实际 %q", got)
	}

	s.UpdateVaccineDose(hepb2.ID, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-28"),
		ClinicName:    "阳光街道社区卫生服务中心",
	})
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("首次常规剂次应自动记住常去门诊，实际 %q", got)
	}

	s.UpdateVaccineDose(polio1.ID, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-28"),
		ClinicName:    "儿童医院",
	})
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("偶发去其他医院不得覆盖既有常去门诊，实际 %q", got)
	}

	s.UpdateVaccineDose(dtap1.ID, vaccines.UpdateDoseInput{
		Status:           vaccines.StatusScheduled,
		ScheduledDate:    ptr("2026-11-29"),
		ClinicName:       "高新社区卫生服务中心",
		SetDefaultClinic: true,
	})
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "高新社区卫生服务中心" {
		t.Fatalf("显式 set_default_clinic=true 应覆写常去门诊，实际 %q", got)
	}

	// 3. 清空默认门诊后，批量预约 2 月龄常规剂次同样触发自动记住。
	client.Put(t, clinicURL, map[string]string{"clinic_name": ""}).RequireStatus(t, http.StatusOK)
	var twoMonthIDs []int64
	for _, d := range ov.Doses {
		if d.AgeMonths == 2 {
			twoMonthIDs = append(twoMonthIDs, d.ID)
		}
	}
	if len(twoMonthIDs) < 2 {
		t.Fatalf("预期至少 2 剂 2 月龄常规疫苗，实际 %d", len(twoMonthIDs))
	}
	client.Post(t, batchURL, vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       twoMonthIDs,
		ScheduledDate: ptr("2026-12-01"),
		ClinicName:    ptr("滨江社区卫生服务中心"),
	}).RequireStatus(t, http.StatusOK)
	if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "滨江社区卫生服务中心" {
		t.Fatalf("批量预约常规剂次应自动记住滨江社区卫生服务中心，实际 %q", got)
	}
	if d := findDoseViewByID(s.GetVaccinesOverview().Doses, twoMonthIDs[0]); d == nil || d.Status != vaccines.StatusScheduled {
		t.Fatalf("批量预约后回读疫苗总览应为 scheduled 态，实际 %+v", d)
	}
}

/*
 * Spec: vaccine-management / Idempotent NIP schedule initialization and overview retrieval / Auto-seed NIP baseline on first retrieval
 * Spec: vaccine-management / Optional vaccine catalog and custom vaccine dose creation / Add an optional vaccine template once with default or customized doses
 * 测试场景：验证并发首次读取疫苗总览的幂等初始化，以及并发重复导入同一自费模板的唯一索引保护。
 * 业务背景：前端首页与疫苗页可能在首次建档后并发请求 /api/babies/:babyId/vaccines，家长双击也可能并发提交 /api/babies/:babyId/vaccines/from-template，必须依靠 SQLite 部分唯一索引守住零重复与准确状态码。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无（疫苗表初始为空）
 * 测试目标：
 * 1. 验证 6 个并发协程同时首次请求 GET /api/babies/:babyId/vaccines 全部返回 200 且 22 剂，SQLite 最终严格落库 22 行无重复。
 * 2. 验证 2 个并发协程同时导入同一自费模板 pcv13 时，严格 1 个返回 201、1 个返回 409，SQLite 中 pcv13 剂次无重复。
 */
func TestVaccinesConcurrentSeedAndTemplateGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	b := app.Scenario().EnsureBaby()
	vacURL := babyPath(b.ID, "/vaccines?tz=Asia/Shanghai")
	tplURL := babyPath(b.ID, "/vaccines/from-template?tz=Asia/Shanghai")
	client := app.Client()

	// 1. 6 路并发首访 GET /api/babies/:babyId/vaccines：子协程仅经并发安全的 ExecuteJSON 收集响应与错误，回到主协程统一断言。
	const seedWorkers = 6
	startSeed := make(chan struct{})
	seedResps := make([]*Response, seedWorkers)
	seedErrs := make([]error, seedWorkers)
	var wg sync.WaitGroup
	for i := range seedWorkers {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-startSeed
			seedResps[idx], seedErrs[idx] = client.ExecuteJSON(http.MethodGet, vacURL, nil)
		}(i)
	}
	close(startSeed)
	wg.Wait()

	for i := range seedWorkers {
		if seedErrs[i] != nil {
			t.Fatalf("并发首访[%d] 请求异常：%v", i, seedErrs[i])
		}
		seedResps[i].RequireStatus(t, http.StatusOK)
		if got := len(DecodeOK[vaccines.OverviewResponse](t, seedResps[i]).Doses); got != 22 {
			t.Fatalf("并发首访[%d] 预期返回 22 剂 NIP，实际 %d", i, got)
		}
	}
	if got := CountRows[vaccines.DoseRecord](t, app, ""); got != 22 {
		t.Fatalf("并发初始化后 SQLite 应严格为 22 剂 NIP，实际 %d", got)
	}

	// 2. 2 路并发导入同一自费模板 pcv13：验证唯一索引约束严格产生一成（201）一败（409）。
	startTpl := make(chan struct{})
	tplResps := make([]*Response, 2)
	tplErrs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-startTpl
			tplResps[idx], tplErrs[idx] = client.ExecuteJSON(http.MethodPost, tplURL, vaccines.AddTemplateInput{
				TemplateCode: "pcv13",
			})
		}(i)
	}
	close(startTpl)
	wg.Wait()

	createdCnt, conflictCnt := 0, 0
	statuses := make([]int, 2)
	for i := range 2 {
		if tplErrs[i] != nil {
			t.Fatalf("并发导入模板[%d] 请求异常：%v", i, tplErrs[i])
		}
		statuses[i] = tplResps[i].StatusCode
		switch tplResps[i].StatusCode {
		case http.StatusCreated:
			createdCnt++
		case http.StatusConflict:
			conflictCnt++
		}
	}
	if createdCnt != 1 || conflictCnt != 1 {
		t.Fatalf("并发导入同一模板必须严格一成一败（201+409），实际状态码=%v", statuses)
	}
	if got := CountRows[vaccines.DoseRecord](t, app, "template_code = ?", "pcv13"); got != 4 {
		t.Fatalf("pcv13 默认模板应严格落库 4 剂，实际 %d", got)
	}
}

/*
 * Spec: vaccine-management / Authenticated access to vaccine endpoints / Reject unauthenticated vaccine request; Reject vaccine request before baby onboarding; Reject vaccine request for foreign baby ID
 * Spec: vaccine-management / Idempotent NIP schedule initialization and overview retrieval / Reject invalid IANA timezone parameter
 * Spec: vaccine-management / Dose status transitions and record updates / Reject updating dose belonging to another baby or user
 * Spec: vaccine-management / Batch appointment booking and historical completion / Roll back batch update when any dose ID is invalid
 * 测试场景：验证疫苗管理接口的未认证（401）、未建档/跨用户/跨宝宝越权拦截（404 含批量原子回滚）与非法时区拒绝（400）。
 * 业务背景：疫苗排期与接种记录高度隐私，须严防跨用户或跨兄弟宝宝篡改单剂与批量混入他人剂次 ID，且非法请求不得触发 NIP 懒初始化。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：用户 A（admin）、待强制改密用户 VacPending、普通用户 B（已完成改密）及匿名客户端
 * - 宝宝档案：步骤 1–2 用户 A 未建档；步骤 3 建档大宝/二宝及用户 B 宝宝，分别初始化疫苗与导入模板
 * - 前置业务记录：步骤 3 经真实接口为各宝宝懒初始化 NIP 疫苗
 * 测试目标：
 * 1. 验证未登录访问 /api/babies/1/vaccines* 返回 401，待强制改密用户返回 403 PASSWORD_CHANGE_REQUIRED，未建档访问 /api/babies/999/vaccines 返回 404 且零落库。
 * 2. 验证非法时区与非法路径 :id 返回 400 且不触发 NIP 懒初始化。
 * 3. 验证跨用户 babyId、跨兄弟宝宝单剂 PUT/DELETE 与模板 DELETE 及批量混入兄弟/他人 dose_id 全部返回 404 且整批回滚，同时不同宝宝独立导入与移出 pcv13 互不干扰。
 */
func TestVaccinesAuthOnboardingAndTimezoneGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	clientA := app.Client()
	clientPending, _ := app.CreateUserViaAdmin("VacPending", "pending-init-secret-123")
	clientB, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	// 1. 未认证返回 401，待强制改密用户返回 403 PASSWORD_CHANGE_REQUIRED，无归属宝宝返回 404 且零落库。
	anon.Get(t, babyPath(1, "/vaccines")).RequireError(t, http.StatusUnauthorized, "")
	anon.Post(t, babyPath(1, "/vaccines"), map[string]any{"vaccine_name": "测试"}).RequireError(t, http.StatusUnauthorized, "")
	for _, suffix := range []string{"/vaccines", "/vaccines/catalog"} {
		payload := DecodeStatus[struct {
			Code string `json:"code"`
		}](t, clientPending.Get(t, babyPath(1, suffix)), http.StatusForbidden)
		if payload.Code != "PASSWORD_CHANGE_REQUIRED" {
			t.Fatalf("待改密用户访问 %s 预期 PASSWORD_CHANGE_REQUIRED，实际 %+v", suffix, payload)
		}
	}

	clientA.Get(t, babyPath(999, "/vaccines")).RequireError(t, http.StatusNotFound, "")
	if got := CountRows[vaccines.DoseRecord](t, app, ""); got != 0 {
		t.Fatalf("无归属宝宝拒绝后不应落库疫苗行，实际 %d", got)
	}

	// 2. 建档后非法时区与非法路径 :id 返回 400，且在进入懒初始化前即已拦截（零行落库）。
	sA := app.ScenarioFor(clientA)
	babyA1 := sA.EnsureBaby(BabyParams{Nickname: "大宝"})
	clientA.Get(t, babyPath(babyA1.ID, "/vaccines?tz=Invalid/Zone")).RequireError(t, http.StatusBadRequest, "")
	clientA.Put(t, babyPath(babyA1.ID, "/vaccines/abc?tz=Asia/Shanghai"), vaccines.UpdateDoseInput{
		Status: vaccines.StatusPending,
	}).RequireError(t, http.StatusBadRequest, "编号")
	clientA.Delete(t, babyPath(babyA1.ID, "/vaccines/0")).RequireError(t, http.StatusBadRequest, "编号")
	if got := CountRows[vaccines.DoseRecord](t, app, ""); got != 0 {
		t.Fatalf("非法时区与非法编号被拒后不应触发 NIP 懒初始化，实际 %d", got)
	}

	// 3. 跨用户 babyId、同用户跨兄弟宝宝单剂 PUT/DELETE 与模板 DELETE 及批量混入他人 dose_id 均返回 404 并完整回滚；多宝宝模板增删互不影响。
	ovA1 := sA.ForBaby(babyA1.ID).SeedVaccines()
	babyA2 := sA.EnsureBaby(BabyParams{Nickname: "二宝"})
	ovA2 := sA.ForBaby(babyA2.ID).SeedVaccines()
	sB := app.ScenarioFor(clientB)
	babyB := sB.EnsureBaby(BabyParams{Nickname: "B宝"})
	ovB := sB.ForBaby(babyB.ID).SeedVaccines()

	// 三个宝宝均可独立导入 pcv13 模板互不冲突。
	pcvA1 := sA.ForBaby(babyA1.ID).AddVaccineTemplate("pcv13")
	sA.ForBaby(babyA2.ID).AddVaccineTemplate("pcv13")
	pcvB := sB.ForBaby(babyB.ID).AddVaccineTemplate("pcv13")

	clientB.Get(t, babyPath(babyA1.ID, "/vaccines")).RequireError(t, http.StatusNotFound, "")
	clientB.Put(t, babyPath(babyA1.ID, "/vaccines/default-clinic"), map[string]string{"clinic_name": "越权门诊"}).
		RequireError(t, http.StatusNotFound, "")
	clientB.Delete(t, babyPath(babyA1.ID, fmt.Sprintf("/vaccines/%d", pcvA1[0].ID))).RequireError(t, http.StatusNotFound, "")
	clientB.Delete(t, babyPath(babyA1.ID, "/vaccines/template/pcv13")).RequireError(t, http.StatusNotFound, "")

	// 挂二宝路径改删大宝剂次、挂大宝路径改删 B 宝剂次均返回 404 且原状态不变。
	targetA1 := ovA1.Doses[0].ID
	targetA2 := ovA2.Doses[0].ID
	targetB := ovB.Doses[0].ID
	clientA.Put(t, babyPath(babyA2.ID, fmt.Sprintf("/vaccines/%d?tz=Asia/Shanghai", targetA1)), vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-30"),
	}).RequireError(t, http.StatusNotFound, "")
	clientA.Put(t, babyPath(babyA1.ID, fmt.Sprintf("/vaccines/%d?tz=Asia/Shanghai", targetB)), vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-30"),
	}).RequireError(t, http.StatusNotFound, "")
	clientA.Delete(t, babyPath(babyA2.ID, fmt.Sprintf("/vaccines/%d", pcvA1[0].ID))).RequireError(t, http.StatusNotFound, "")
	clientA.Delete(t, babyPath(babyA1.ID, fmt.Sprintf("/vaccines/%d", pcvB[0].ID))).RequireError(t, http.StatusNotFound, "")
	if CountRows[vaccines.DoseRecord](t, app, "baby_id = ? AND template_code = ?", babyA1.ID, "pcv13") != 4 ||
		CountRows[vaccines.DoseRecord](t, app, "baby_id = ? AND template_code = ?", babyB.ID, "pcv13") != 4 {
		t.Fatalf("跨宝宝/跨用户越权 DELETE 被拒后 pcv13 剂次不应被误删")
	}

	// 大宝整套移出 pcv13 仅清除大宝，不影响二宝与 B 宝已加入的 pcv13。
	clientA.Delete(t, babyPath(babyA1.ID, "/vaccines/template/pcv13")).RequireStatus(t, http.StatusOK)
	if CountRows[vaccines.DoseRecord](t, app, "baby_id = ? AND template_code = ?", babyA1.ID, "pcv13") != 0 ||
		CountRows[vaccines.DoseRecord](t, app, "baby_id = ? AND template_code = ?", babyA2.ID, "pcv13") != 4 {
		t.Fatalf("移出大宝 pcv13 模板后仅应清除大宝而保留二宝剂次")
	}

	// 批量更新混入兄弟宝宝剂次与他用户剂次必须整体回滚返回 404，合法剂次保持 pending。
	clientA.Post(t, babyPath(babyA1.ID, "/vaccines/batch?tz=Asia/Shanghai"), vaccines.BatchUpdateInput{
		Action:           vaccines.BatchActionSchedule,
		DoseIDs:          []int64{targetA1, targetA2},
		ScheduledDate:    ptr("2026-12-01"),
		ClinicName:       ptr("不应记住的越权门诊"),
		SetDefaultClinic: true,
	}).RequireError(t, http.StatusNotFound, "")
	clientA.Post(t, babyPath(babyA1.ID, "/vaccines/batch?tz=Asia/Shanghai"), vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       []int64{targetA1, targetB},
		ScheduledDate: ptr("2026-12-01"),
	}).RequireError(t, http.StatusNotFound, "")

	if row := FirstRow[vaccines.DoseRecord](t, app, "id = ?", targetA1); row.Status != vaccines.StatusPending {
		t.Fatalf("跨宝宝批量越权回滚后 targetA1 应保持 pending，实际 %+v", row)
	}
	if got := FirstRow[baby.Profile](t, app, "id = ?", babyA1.ID).DefaultClinicName; got != "" {
		t.Fatalf("跨宝宝批量越权回滚后常去门诊应保持为空，实际 %q", got)
	}
}
