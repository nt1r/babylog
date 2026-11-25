package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
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
 * Spec: vaccine-management / Authenticated access to vaccine endpoints / Reject unauthenticated vaccine request; Reject vaccine request before baby onboarding
 * Spec: vaccine-management / Idempotent NIP schedule initialization and overview retrieval / Reject invalid IANA timezone parameter
 * 场景：验证疫苗接口的认证门禁（401）、宝宝建档前置门禁（409）与非法时区参数拒绝（400）。
 * 前置：隔离环境内已初始化管理员，初始未建档；验证 409 后建档再测非法 tz。
 * 目标：
 * 1. 验证未登录访问 GET/POST /api/vaccines 返回 401。
 * 2. 验证已登录未建档访问 GET /api/vaccines 返回 409。
 * 3. 验证建档后携带非法 tz=Invalid/Zone 访问 GET /api/vaccines 返回 400 中文错误。
 */
func TestVaccinesAuthOnboardingAndTimezoneGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	client := app.Client()

	// 1. 未认证返回 401。
	anon.Get(t, "/api/vaccines").RequireError(t, http.StatusUnauthorized, "")
	anon.Post(t, "/api/vaccines", map[string]any{"vaccine_name": "测试"}).RequireError(t, http.StatusUnauthorized, "")

	// 2. 已认证未建档返回 409。
	client.Get(t, "/api/vaccines").RequireError(t, http.StatusConflict, "建档")

	// 3. 建档后非法时区返回 400。
	app.Scenario().EnsureBaby()
	client.Get(t, "/api/vaccines?tz=Invalid/Zone").RequireError(t, http.StatusBadRequest, "")
}

/*
 * Spec: vaccine-management / Idempotent NIP schedule initialization and overview retrieval / Auto-seed NIP baseline on first retrieval; Compute effective due dates with month-end clamping
 * Spec: vaccine-management / Derived reminder states and birth vaccine quick-confirm eligibility / Derive due_soon and overdue states for pending doses; Report birth hospital vaccines pending for explicit user confirmation
 * 场景：验证首次获取幂等初始化 22 剂 NIP 与产院两针待确认提示、月末出生（1/31→2/28）日期钳位，以及 upcoming / due_soon / overdue 派生提醒状态。
 * 前置：固定时钟 2026-06-15 10:00+08:00，宝宝出生日期为 2026-01-31。
 * 目标：
 * 1. 验证首次 GET /api/vaccines 落库 22 剂 NIP（含产院两针 pending 与免责声明），二次调用幂等不重复。
 * 2. 验证 2026-01-31 出生宝宝 1 月龄乙肝第 2 剂 effective_date 钳位为 2026-02-28 而非溢出 3 月。
 * 3. 验证 2026-06-15 当天，planned_date 分别为 2026-07-10 / 2026-06-25 / 2026-05-20 的待接种剂次分别派生为 upcoming / due_soon / overdue。
 */
func TestVaccinesSeedClampingAndAlertStates(t *testing.T) {
	t.Parallel()

	// 2026-06-15 10:00:00+08:00（UTC 02:00）。
	app := NewTestApp(t, WithClock(time.Date(2026, 6, 15, 2, 0, 0, 0, time.UTC)))
	s := app.Scenario()
	s.EnsureBaby(BabyParams{BirthDate: "2026-01-31"})

	// 1. 首次读取自动落库 22 剂 NIP 并上报产院两针待确认；二次读取保持 22 剂幂等。
	ov1 := s.SeedVaccines("Asia/Shanghai")
	if len(ov1.Doses) != 22 || ov1.Summary.NIPTotal != 22 ||
		!ov1.Summary.BirthConfirmPending || len(ov1.Summary.BirthPendingDoseIDs) != 2 ||
		ov1.Disclaimer == "" || ov1.DefaultClinicName != "" {
		t.Fatalf("unexpected initial vaccine overview: total=%d summary=%+v clinic=%q",
			len(ov1.Doses), ov1.Summary, ov1.DefaultClinicName)
	}
	if got := CountRows[vaccines.DoseRecord](t, app, ""); got != 22 {
		t.Fatalf("expected 22 NIP rows persisted in SQLite, got %d", got)
	}
	ov2 := s.SeedVaccines("Asia/Shanghai")
	if len(ov2.Doses) != 22 || CountRows[vaccines.DoseRecord](t, app, "") != 22 {
		t.Fatalf("expected idempotent 22 NIP doses on second retrieval, got %d", len(ov2.Doses))
	}

	// 2. 核对 2026-01-31 出生宝宝的 1 月龄乙肝第 2 剂自动钳位为 2026-02-28。
	hepb2 := findDoseViewByTemplate(ov1.Doses, "hepb", 2)
	if hepb2 == nil || hepb2.DefaultDueDate != "2026-02-28" || hepb2.EffectiveDate != "2026-02-28" {
		t.Fatalf("expected hepb#2 clamped to 2026-02-28, got %+v", hepb2)
	}

	// 3. 创建 3 剂带明确 planned_date 的待接种疫苗，验证基于 2026-06-15 派生的三种提醒状态。
	custom := s.AddCustomVaccine(vaccines.CreateCustomInput{
		VaccineName: "状态边界测试疫苗",
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
		t.Fatalf("unexpected derived alert states: [0]=%s [1]=%s [2]=%s",
			custom[0].AlertState, custom[1].AlertState, custom[2].AlertState)
	}
}

/*
 * Spec: vaccine-management / Optional vaccine catalog and custom vaccine dose creation / Add an optional vaccine template once with default or customized doses; Create a custom vaccine series; Reject invalid custom vaccine payload
 * Spec: vaccine-management / Controlled deletion, automatic renumbering, and template removal / Delete a middle dose and renumber subsequent siblings; Remove an entire optional template series; Reject deletion of built-in NIP dose
 * 场景：验证自费目录、模板定制与防重复、flu 定制阶段文案保留、多剂自定义疫苗、删除重排与整套移出、NIP 删除拦截及非法载荷 400。
 * 前置：已建档宝宝并初始化 22 剂 NIP 基线。
 * 目标：
 * 1. 验证目录返回 5 个自费模板，定制添加 pcv13 返回 201 且重复添加返回 409；flu 保留定制 AgeLabel。
 * 2. 验证删除 pcv13 与自定义疫苗的中间剂次后，SQLite 剩余兄弟剂次自动重排为连续 1..N-1；整套删除模板后目录恢复 added=false。
 * 3. 验证删除内置 NIP 单剂/模板返回 400 且原行保留；非法自定义载荷返回 400 且无脏写。
 */
func TestVaccinesTemplatesCustomAndDeletion(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	s.EnsureBaby()
	ov := s.SeedVaccines()
	client := app.Client()

	fetchCatalog := func() vaccines.CatalogResponse {
		t.Helper()
		resp := client.Get(t, "/api/vaccines/catalog")
		resp.RequireStatus(t, http.StatusOK)
		return DecodeJSON[vaccines.CatalogResponse](t, resp)
	}

	// 1. 自费目录包含 5 套模板与默认剂次明细；定制添加 3 剂 pcv13，重复添加返回 409；同时验证 flu 保留定制 AgeLabel。
	cat := fetchCatalog()
	if len(cat.Templates) != 5 || len(cat.Templates[0].Doses) == 0 {
		t.Fatalf("expected 5 optional templates with default doses, got %+v", cat.Templates)
	}

	pcv := s.AddVaccineTemplate("pcv13", 7, 9, 12)
	if len(pcv) != 3 || pcv[1].DoseNumber != 2 || pcv[1].TotalDoses != 3 || pcv[1].AgeMonths != 9 {
		t.Fatalf("unexpected customized pcv13 doses: %+v", pcv)
	}
	cat = fetchCatalog()
	var pcvItem *vaccines.CatalogItem
	for i := range cat.Templates {
		if cat.Templates[i].Code == "pcv13" {
			pcvItem = &cat.Templates[i]
		}
	}
	if pcvItem == nil || !pcvItem.Added || pcvItem.AddedDoseCount != 3 {
		t.Fatalf("expected pcv13 added=true with 3 doses in catalog, got %+v", pcvItem)
	}
	client.Post(t, "/api/vaccines/from-template?tz=Asia/Shanghai", vaccines.AddTemplateInput{
		TemplateCode: "pcv13",
	}).RequireError(t, http.StatusConflict, "")

	// 添加 flu 模板并保留默认月龄（6/7），验证定制 AgeLabel 保留且同月龄更新时不丢失。
	flu := s.AddVaccineTemplate("flu", 6, 7)
	if len(flu) != 2 || flu[0].AgeLabel != "6月龄起" || flu[1].AgeLabel != "首季第2剂" {
		t.Fatalf("expected flu custom AgeLabel preserved, got %+v", flu)
	}
	updFluResp := client.Put(t, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", flu[0].ID), vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		AgeMonths:     ptr(6),
		ScheduledDate: ptr("2026-12-01"),
	})
	updFluResp.RequireStatus(t, http.StatusOK)
	if got := DecodeJSON[struct {
		Dose vaccines.DoseView `json:"dose"`
	}](t, updFluResp).Dose.AgeLabel; got != "6月龄起" {
		t.Fatalf("expected flu AgeLabel kept on same age_months update, got %q", got)
	}

	// 2. 删除 pcv13 与自定义疫苗的中间第 2 剂验证剩余重排为连续 1..N-1，并验证整套移出模板后目录恢复 added=false。
	client.Delete(t, fmt.Sprintf("/api/vaccines/%d", pcv[1].ID)).RequireStatus(t, http.StatusOK)
	pcvRows := FindRows[vaccines.DoseRecord](t, app, "dose_number ASC", "template_code = ?", "pcv13")
	if len(pcvRows) != 2 || pcvRows[0].DoseNumber != 1 || pcvRows[0].TotalDoses != 2 || pcvRows[0].AgeMonths != 7 ||
		pcvRows[1].DoseNumber != 2 || pcvRows[1].TotalDoses != 2 || pcvRows[1].AgeMonths != 12 {
		t.Fatalf("expected pcv13 renumbered to 1/2(7m) and 2/2(12m), got %+v", pcvRows)
	}

	client.Delete(t, "/api/vaccines/template/pcv13").RequireStatus(t, http.StatusOK)
	if got := CountRows[vaccines.DoseRecord](t, app, "template_code = ?", "pcv13"); got != 0 {
		t.Fatalf("expected 0 pcv13 rows after template removal, got %d", got)
	}
	cat = fetchCatalog()
	for _, tpl := range cat.Templates {
		if tpl.Code == "pcv13" && tpl.Added {
			t.Fatalf("expected pcv13 catalog added=false after template removal")
		}
	}

	// 创建 3 剂自定义疫苗并删除中间第 2 剂，回读 SQLite 验证剩余重排为 1/2（2m）、2/2（4m）。
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
		t.Fatalf("unexpected custom doses: %+v", custom)
	}
	client.Delete(t, fmt.Sprintf("/api/vaccines/%d", custom[1].ID)).RequireStatus(t, http.StatusOK)
	customRows := FindRows[vaccines.DoseRecord](t, app, "dose_number ASC", "vaccine_name = ?", "五联疫苗")
	if len(customRows) != 2 || customRows[0].DoseNumber != 1 || customRows[0].TotalDoses != 2 ||
		customRows[1].DoseNumber != 2 || customRows[1].TotalDoses != 2 || customRows[1].AgeMonths != 4 {
		t.Fatalf("unexpected custom renumbered rows in SQLite: %+v", customRows)
	}

	// 3. 拒绝删除内置 NIP 单剂/模板（原行保留），并拒绝全部非法自定义疫苗载荷（库行数不变）。
	nipDoseID := ov.Doses[0].ID
	client.Delete(t, fmt.Sprintf("/api/vaccines/%d", nipDoseID)).RequireError(t, http.StatusBadRequest, "")
	client.Delete(t, "/api/vaccines/template/hepb").RequireError(t, http.StatusBadRequest, "")
	if got := CountRows[vaccines.DoseRecord](t, app, "id = ?", nipDoseID); got != 1 {
		t.Fatalf("expected protected NIP dose preserved in SQLite, count=%d", got)
	}

	// 非法自定义疫苗载荷全部返回 400 且 SQLite 剂次总数不变。
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
		client.Post(t, "/api/vaccines?tz=Asia/Shanghai", in).RequireError(t, http.StatusBadRequest, "")
	}
	if afterCount := CountRows[vaccines.DoseRecord](t, app, ""); afterCount != beforeCount {
		t.Fatalf("expected SQLite dose count unchanged (%d), got %d", beforeCount, afterCount)
	}
}

/*
 * Spec: vaccine-management / Dose status transitions and record updates / Book an appointment for a pending dose; Record a completed vaccination; Revert a dose back to pending; Reject completion with out-of-bounds vaccination date
 * Spec: vaccine-management / Batch appointment booking and historical completion / Batch-mark multiple same-stage doses as completed; Roll back batch update when any dose ID is invalid; Batch update rolls back default clinic change on invalid dose ID
 * 场景：验证单剂三态流转与废弃列清空、越界接种日期 400、批量确认与三态字段语义，以及含非法 ID 时批量事务（含默认门诊修改）完整回滚。
 * 前置：已建档宝宝并初始化 NIP 基线。
 * 目标：
 * 1. 验证单剂 pending → scheduled → completed → pending 每步落库终态，回退 pending 后预约与接种列全部清空。
 * 2. 验证早于出生日或晚于本地今天的 vaccinated_at 返回 400。
 * 3. 验证批量完成产院两针更新进度与 recent_clinics；批量更新省略 clinic_name/note 保留旧值、传 "" 清空。
 * 4. 验证批量请求含不存在 ID（含 set_default_clinic=true）返回 404，回读 SQLite 确认合法剂次与 default_clinic_name 均回滚未改。
 */
func TestVaccinesDoseTransitionsAndBatchAtomicity(t *testing.T) {
	t.Parallel()

	t.Run("单剂三态流转回退清零与接种日期越界拒绝", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby() // 默认出生日 2026-07-15，固定时钟 2026-11-23+08
		ov := s.SeedVaccines()
		client := app.Client()

		hepb2 := findDoseViewByTemplate(ov.Doses, "hepb", 2)
		if hepb2 == nil {
			t.Fatalf("hepb dose #2 not found")
		}
		endpoint := fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", hepb2.ID)

		// pending → scheduled，回读 SQLite 确认预约列落库且 vaccinated_at 为 NULL。
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
			t.Fatalf("unexpected scheduled SQLite row: %+v", row)
		}

		// 拒绝未来日期（2026-11-24）与早于出生日（2020-01-01）的接种完成请求。
		client.Put(t, endpoint, vaccines.UpdateDoseInput{
			Status: vaccines.StatusCompleted, VaccinatedAt: ptr("2026-11-24"),
		}).RequireError(t, http.StatusBadRequest, "")
		client.Put(t, endpoint, vaccines.UpdateDoseInput{
			Status: vaccines.StatusCompleted, VaccinatedAt: ptr("2020-01-01"),
		}).RequireError(t, http.StatusBadRequest, "")

		// scheduled → completed，回读 SQLite 确认 scheduled_date/time 清空为 NULL、接种字段落库。
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
			t.Fatalf("unexpected completed SQLite row: %+v", row)
		}
		ovAfter := s.SeedVaccines()
		if !slices.Contains(ovAfter.RecentClinics, "城西社区卫生服务中心") {
			t.Fatalf("expected recent_clinics to contain 城西社区卫生服务中心, got %v", ovAfter.RecentClinics)
		}

		// completed → pending，回读 SQLite 确认全部预约与接种列均已清空。
		client.Put(t, endpoint, vaccines.UpdateDoseInput{
			Status: vaccines.StatusPending,
		}).RequireStatus(t, http.StatusOK)
		row = FirstRow[vaccines.DoseRecord](t, app, "id = ?", hepb2.ID)
		if row.Status != vaccines.StatusPending || row.ScheduledDate != nil || row.ScheduledTime != nil ||
			row.VaccinatedAt != nil || row.Site != "" || row.Manufacturer != "" ||
			row.BatchNo != "" || row.Reaction != "" || row.ClinicName != "" {
			t.Fatalf("expected all booking/completion columns cleared on revert to pending, got %+v", row)
		}
	})

	t.Run("批量确认三态保留与含非法ID整事务回滚", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		profile := s.EnsureBaby()
		ov := s.SeedVaccines()
		client := app.Client()

		// 批量完成产院两针并验证 birth_confirm_pending 清除、进度计数与 recent_clinics 更新。
		client.Post(t, "/api/vaccines/batch?tz=Asia/Shanghai", vaccines.BatchUpdateInput{
			Action:       vaccines.BatchActionComplete,
			DoseIDs:      ov.Summary.BirthPendingDoseIDs,
			VaccinatedAt: ptr(profile.BirthDate),
			ClinicName:   ptr("妇幼保健院产科"),
		}).RequireStatus(t, http.StatusOK)

		ovAfterBirth := s.SeedVaccines()
		if ovAfterBirth.Summary.BirthConfirmPending || ovAfterBirth.Summary.NIPCompleted != 2 ||
			!slices.Contains(ovAfterBirth.RecentClinics, "妇幼保健院产科") {
			t.Fatalf("unexpected overview after birth batch confirm: summary=%+v clinics=%v",
				ovAfterBirth.Summary, ovAfterBirth.RecentClinics)
		}

		// 批量预约三态语义：传 nil 保留既有门诊与备注，传 "" 显式清空门诊。
		polio1 := findDoseViewByTemplate(ovAfterBirth.Doses, "polio", 1)
		if polio1 == nil {
			t.Fatalf("polio dose #1 not found")
		}
		client.Post(t, "/api/vaccines/batch?tz=Asia/Shanghai", vaccines.BatchUpdateInput{
			Action:        vaccines.BatchActionSchedule,
			DoseIDs:       []int64{polio1.ID},
			ScheduledDate: ptr("2026-11-28"),
			ClinicName:    ptr("阳光街道社区卫生服务中心"),
			Note:          ptr("需携带接种证"),
		}).RequireStatus(t, http.StatusOK)
		client.Post(t, "/api/vaccines/batch?tz=Asia/Shanghai", vaccines.BatchUpdateInput{
			Action:        vaccines.BatchActionSchedule,
			DoseIDs:       []int64{polio1.ID},
			ScheduledDate: ptr("2026-11-29"),
		}).RequireStatus(t, http.StatusOK)
		polioRow := FirstRow[vaccines.DoseRecord](t, app, "id = ?", polio1.ID)
		if polioRow.ClinicName != "阳光街道社区卫生服务中心" || polioRow.Note != "需携带接种证" {
			t.Fatalf("expected omitted batch clinic/note preserved, got clinic=%q note=%q", polioRow.ClinicName, polioRow.Note)
		}
		client.Post(t, "/api/vaccines/batch?tz=Asia/Shanghai", vaccines.BatchUpdateInput{
			Action:        vaccines.BatchActionSchedule,
			DoseIDs:       []int64{polio1.ID},
			ScheduledDate: ptr("2026-11-29"),
			ClinicName:    ptr(""),
		}).RequireStatus(t, http.StatusOK)
		polioRow = FirstRow[vaccines.DoseRecord](t, app, "id = ?", polio1.ID)
		if polioRow.ClinicName != "" || polioRow.Note != "需携带接种证" {
			t.Fatalf("expected empty batch clinic cleared while note preserved, got clinic=%q note=%q", polioRow.ClinicName, polioRow.Note)
		}

		// 批量请求包含不存在 ID 且携带 set_default_clinic=true：返回 404 且剂次与 default_clinic_name 均回滚未改。
		dtap1 := findDoseViewByTemplate(ovAfterBirth.Doses, "dtap", 1)
		if dtap1 == nil {
			t.Fatalf("dtap dose #1 not found")
		}
		client.Post(t, "/api/vaccines/batch?tz=Asia/Shanghai", vaccines.BatchUpdateInput{
			Action:           vaccines.BatchActionComplete,
			DoseIDs:          []int64{dtap1.ID, 999999},
			VaccinatedAt:     ptr("2026-11-23"),
			ClinicName:       ptr("错误回滚医院"),
			SetDefaultClinic: true,
		}).RequireError(t, http.StatusNotFound, "")

		dtapRow := FirstRow[vaccines.DoseRecord](t, app, "id = ?", dtap1.ID)
		if dtapRow.Status != vaccines.StatusPending || dtapRow.VaccinatedAt != nil || dtapRow.ClinicName != "" {
			t.Fatalf("expected dtap#1 rolled back to pending, got %+v", dtapRow)
		}
		babyRow := FirstRow[baby.Profile](t, app, "id = ?", profile.ID)
		if babyRow.DefaultClinicName != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected default_clinic_name rolled back to 阳光街道社区卫生服务中心, got %q", babyRow.DefaultClinicName)
		}
	})
}

/*
 * Spec: vaccine-management / Explicit default vaccination clinic management / Set and clear default vaccination clinic; Reject oversized default clinic name
 * Spec: vaccine-management / Dose status transitions and record updates / Auto-remember first non-birth clinic and respect explicit default clinic pin
 * Spec: vaccine-management / Batch appointment booking and historical completion
 * 场景：验证常去门诊独立接口（设置/同步/超长 400/清空）、产院不污染与首次常规自动记住规则、偶发不覆盖、显式 pin 覆写，以及批量常规预约自动记住。
 * 前置：每项子测试独立建档并初始化 NIP 基线。
 * 目标：
 * 1. 验证 PUT /api/vaccines/default-clinic 裁剪落库并与 GET /api/vaccines、GET /api/baby 一致，超 80 字返回 400 且不改库，传 "" 清空。
 * 2. 验证产院剂次不污染空默认门诊 → 首次常规剂次自动记住 → 偶发门诊不覆盖 → set_default_clinic=true 显式覆写。
 * 3. 验证空默认门诊时批量预约常规剂次同样原子自动记住常去门诊。
 */
func TestVaccinesDefaultClinicManagementAndAutoRemember(t *testing.T) {
	t.Parallel()

	t.Run("常去门诊独立接口与单剂自动记住规则", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		profile := s.EnsureBaby()
		ov := s.SeedVaccines()
		client := app.Client()

		// PUT /api/vaccines/default-clinic 显式设置、跨端点同步校验、超长 400 与清空。
		setResp := client.Put(t, "/api/vaccines/default-clinic", map[string]string{
			"clinic_name": "  阳光街道社区卫生服务中心  ",
		})
		setResp.RequireStatus(t, http.StatusOK)
		if got := DecodeJSON[struct {
			DefaultClinicName string `json:"default_clinic_name"`
		}](t, setResp).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("unexpected set default clinic response: %q", got)
		}
		if s.SeedVaccines().DefaultClinicName != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected GET /api/vaccines default_clinic_name synced")
		}
		babyResp := client.Get(t, "/api/baby")
		babyResp.RequireStatus(t, http.StatusOK)
		if got := DecodeJSON[struct {
			Baby baby.Profile `json:"baby"`
		}](t, babyResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected GET /api/baby default_clinic_name synced, got %q", got)
		}

		client.Put(t, "/api/vaccines/default-clinic", map[string]string{
			"clinic_name": strings.Repeat("院", baby.MaxClinicNameLength+1),
		}).RequireError(t, http.StatusBadRequest, "80")
		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected default_clinic_name unchanged after 400, got %q", got)
		}

		client.Put(t, "/api/vaccines/default-clinic", map[string]string{"clinic_name": ""}).RequireStatus(t, http.StatusOK)
		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "" {
			t.Fatalf("expected default_clinic_name cleared in SQLite, got %q", got)
		}

		// 产院出生剂次（HepB#1）不污染空默认门诊。
		hepb1 := findDoseViewByTemplate(ov.Doses, "hepb", 1)
		hepb2 := findDoseViewByTemplate(ov.Doses, "hepb", 2)
		polio1 := findDoseViewByTemplate(ov.Doses, "polio", 1)
		dtap1 := findDoseViewByTemplate(ov.Doses, "dtap", 1)
		if hepb1 == nil || hepb2 == nil || polio1 == nil || dtap1 == nil {
			t.Fatalf("missing expected NIP baseline doses")
		}

		client.Put(t, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", hepb1.ID), vaccines.UpdateDoseInput{
			Status:       vaccines.StatusCompleted,
			VaccinatedAt: ptr(profile.BirthDate),
			ClinicName:   "市妇幼保健院",
		}).RequireStatus(t, http.StatusOK)
		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "" {
			t.Fatalf("expected birth dose not to pollute default_clinic_name, got %q", got)
		}

		// 首次常规剂次自动记住常去门诊。
		client.Put(t, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", hepb2.ID), vaccines.UpdateDoseInput{
			Status:        vaccines.StatusScheduled,
			ScheduledDate: ptr("2026-11-28"),
			ClinicName:    "阳光街道社区卫生服务中心",
		}).RequireStatus(t, http.StatusOK)
		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected auto-remembered default_clinic_name, got %q", got)
		}

		// 偶发其他医院（未传 set_default_clinic）不覆盖既有默认门诊。
		client.Put(t, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", polio1.ID), vaccines.UpdateDoseInput{
			Status:        vaccines.StatusScheduled,
			ScheduledDate: ptr("2026-11-28"),
			ClinicName:    "儿童医院",
		}).RequireStatus(t, http.StatusOK)
		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected one-off clinic not to overwrite default_clinic_name, got %q", got)
		}

		// 显式 set_default_clinic=true 覆写默认门诊并落库。
		client.Put(t, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", dtap1.ID), vaccines.UpdateDoseInput{
			Status:           vaccines.StatusScheduled,
			ScheduledDate:    ptr("2026-11-29"),
			ClinicName:       "高新社区卫生服务中心",
			SetDefaultClinic: true,
		}).RequireStatus(t, http.StatusOK)
		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "高新社区卫生服务中心" {
			t.Fatalf("expected explicitly pinned default_clinic_name, got %q", got)
		}
		if got := s.SeedVaccines().DefaultClinicName; got != "高新社区卫生服务中心" {
			t.Fatalf("expected overview default_clinic_name updated, got %q", got)
		}
	})

	t.Run("批量预约常规剂次自动记住常去门诊", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		profile := s.EnsureBaby()
		ov := s.SeedVaccines()

		// 收集 2 月龄常规待接种剂次并发起批量预约，验证空默认门诊被自动记住且剂次状态落库。
		var twoMonthIDs []int64
		for _, d := range ov.Doses {
			if d.AgeMonths == 2 {
				twoMonthIDs = append(twoMonthIDs, d.ID)
			}
		}
		if len(twoMonthIDs) < 2 {
			t.Fatalf("expected >=2 2-month routine doses, got %d", len(twoMonthIDs))
		}

		app.Client().Post(t, "/api/vaccines/batch?tz=Asia/Shanghai", vaccines.BatchUpdateInput{
			Action:        vaccines.BatchActionSchedule,
			DoseIDs:       twoMonthIDs,
			ScheduledDate: ptr("2026-12-01"),
			ClinicName:    ptr("滨江社区卫生服务中心"),
		}).RequireStatus(t, http.StatusOK)

		if got := FirstRow[baby.Profile](t, app, "id = ?", profile.ID).DefaultClinicName; got != "滨江社区卫生服务中心" {
			t.Fatalf("expected batch schedule to auto-remember 滨江社区卫生服务中心, got %q", got)
		}
		if d := findDoseViewByID(s.SeedVaccines().Doses, twoMonthIDs[0]); d == nil || d.Status != vaccines.StatusScheduled {
			t.Fatalf("expected scheduled status persisted for batch doses, got %+v", d)
		}
	})
}
