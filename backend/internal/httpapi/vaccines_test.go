package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/vaccines"
)

func TestVaccinesAuthAndOnboardingGates(t *testing.T) {
	env := setupFullTestServer(t, func() time.Time { return fixedNow })

	// 1. 未登录返回 401
	resp := env.doJSON(t, http.MethodGet, "/api/vaccines", nil, false)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated GET /api/vaccines, got %d", resp.StatusCode)
	}

	resp = env.doJSON(t, http.MethodPost, "/api/vaccines", map[string]any{"vaccine_name": "测试"}, false)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated POST /api/vaccines, got %d", resp.StatusCode)
	}

	// 2. 已登录未建档返回 409
	resp = env.doJSON(t, http.MethodGet, "/api/vaccines", nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 before baby onboarding, got %d", resp.StatusCode)
	}
}

func fetchOverview(t *testing.T, env *fullTestEnv) vaccines.OverviewResponse {
	t.Helper()
	resp := env.doJSON(t, http.MethodGet, "/api/vaccines?tz=Asia/Shanghai", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 GET /api/vaccines, got %d", resp.StatusCode)
	}
	var ov vaccines.OverviewResponse
	if err := json.NewDecoder(resp.Body).Decode(&ov); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	_ = resp.Body.Close()
	return ov
}

func fetchCatalog(t *testing.T, env *fullTestEnv) vaccines.CatalogResponse {
	t.Helper()
	resp := env.doJSON(t, http.MethodGet, "/api/vaccines/catalog", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 catalog, got %d", resp.StatusCode)
	}
	var cat vaccines.CatalogResponse
	if err := json.NewDecoder(resp.Body).Decode(&cat); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	_ = resp.Body.Close()
	return cat
}

func findDoseByID(doses []vaccines.DoseView, id int64) *vaccines.DoseView {
	for i := range doses {
		if doses[i].ID == id {
			return &doses[i]
		}
	}
	return nil
}

func TestVaccinesEndToEndLifecycle(t *testing.T) {
	// 固定时钟在 2026-11-23 10:00+08:00，默认宝宝出生日期在 createDefaultBaby 中创建。
	env := setupFullTestServer(t, func() time.Time { return fixedNow })
	env.createDefaultBaby(t)

	// 1. 非法时区返回 400
	resp := env.doJSON(t, http.MethodGet, "/api/vaccines?tz=Invalid/Zone", nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid tz, got %d", resp.StatusCode)
	}

	// 2. 首次获取自动初始化 22 剂 NIP，二次获取幂等
	ov := fetchOverview(t, env)
	if len(ov.Doses) != 22 || ov.Summary.NIPTotal != 22 || !ov.Summary.BirthConfirmPending || len(ov.Summary.BirthPendingDoseIDs) != 2 {
		t.Fatalf("unexpected initial overview: total=%d nip=%d birthPending=%v ids=%v",
			len(ov.Doses), ov.Summary.NIPTotal, ov.Summary.BirthConfirmPending, ov.Summary.BirthPendingDoseIDs)
	}
	if ov.Disclaimer == "" {
		t.Fatalf("expected non-empty medical disclaimer")
	}
	ovAgain := fetchOverview(t, env)
	if len(ovAgain.Doses) != 22 || ovAgain.Summary.NIPTotal != 22 {
		t.Fatalf("expected idempotent 22 doses on second GET /api/vaccines, got %d", len(ovAgain.Doses))
	}

	// 3. 批量确认产院两针已接种并回读校验
	resp = env.doJSON(t, http.MethodPost, "/api/vaccines/batch?tz=Asia/Shanghai", map[string]any{
		"action":        "complete",
		"dose_ids":      ov.Summary.BirthPendingDoseIDs,
		"vaccinated_at": ov.BirthDate,
		"clinic_name":   "妇幼保健院产科",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 batch confirm birth doses, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	ov = fetchOverview(t, env)
	if ov.Summary.BirthConfirmPending || ov.Summary.NIPCompleted != 2 {
		t.Fatalf("expected birthConfirmPending=false and NIPCompleted=2, got %+v", ov.Summary)
	}
	if len(ov.RecentClinics) == 0 || ov.RecentClinics[0] != "妇幼保健院产科" {
		t.Fatalf("expected recent clinic remembered, got %v", ov.RecentClinics)
	}

	// 4. 查询自费目录（验证返回默认剂次明细）并定制添加 pcv13（3 剂：7/9/12 月龄），二次添加返回 409
	cat := fetchCatalog(t, env)
	if len(cat.Templates) != 5 || len(cat.Templates[0].Doses) == 0 {
		t.Fatalf("expected 5 optional templates with default doses, got %+v", cat.Templates)
	}

	resp = env.doJSON(t, http.MethodPost, "/api/vaccines/from-template?tz=Asia/Shanghai", map[string]any{
		"template_code": "pcv13",
		"doses": []map[string]any{
			{"age_months": 7},
			{"age_months": 9},
			{"age_months": 12},
		},
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 add customized pcv13, got %d", resp.StatusCode)
	}
	var addedTpl struct {
		Doses []vaccines.DoseView `json:"doses"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&addedTpl); err != nil {
		t.Fatalf("decode added template: %v", err)
	}
	_ = resp.Body.Close()
	if len(addedTpl.Doses) != 3 || addedTpl.Doses[1].DoseNumber != 2 || addedTpl.Doses[1].TotalDoses != 3 || addedTpl.Doses[1].AgeMonths != 9 {
		t.Fatalf("expected 3 customized pcv13 doses, got %+v", addedTpl.Doses)
	}

	// 再次查询目录确认 pcv13.added == true 且 added_dose_count == 3
	cat = fetchCatalog(t, env)
	var pcvItem *vaccines.CatalogItem
	for i := range cat.Templates {
		if cat.Templates[i].Code == "pcv13" {
			pcvItem = &cat.Templates[i]
		}
	}
	if pcvItem == nil || !pcvItem.Added || pcvItem.AddedDoseCount != 3 {
		t.Fatalf("expected pcv13 added=true with 3 doses, got %+v", pcvItem)
	}

	resp = env.doJSON(t, http.MethodPost, "/api/vaccines/from-template?tz=Asia/Shanghai", map[string]any{
		"template_code": "pcv13",
	}, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 duplicate template, got %d", resp.StatusCode)
	}

	// 5. 新增多剂自定义疫苗（2 剂）
	resp = env.doJSON(t, http.MethodPost, "/api/vaccines?tz=Asia/Shanghai", map[string]any{
		"vaccine_name": "乙脑灭活疫苗",
		"category":     "optional",
		"note":         "社区门诊通知",
		"doses": []map[string]any{
			{"age_months": 8, "planned_date": "2027-06-01"},
			{"age_months": 24},
		},
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 custom doses, got %d", resp.StatusCode)
	}
	var createdCustom struct {
		Doses []vaccines.DoseView `json:"doses"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&createdCustom); err != nil {
		t.Fatalf("decode custom doses: %v", err)
	}
	_ = resp.Body.Close()
	if len(createdCustom.Doses) != 2 || createdCustom.Doses[0].DoseNumber != 1 || createdCustom.Doses[1].DoseNumber != 2 {
		t.Fatalf("expected 2 numbered custom doses, got %+v", createdCustom.Doses)
	}

	// 6. 单剂预约、拒绝未来接种日期、合法标记接种，并回读 GET /api/vaccines 验证落库终态与 recent_clinics
	targetID := addedTpl.Doses[0].ID
	resp = env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", targetID), map[string]any{
		"status":         "scheduled",
		"scheduled_date": "2026-11-28",
		"scheduled_time": "09:00",
		"clinic_name":    "城西社区卫生服务中心",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 schedule dose, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	ov = fetchOverview(t, env)
	dScheduled := findDoseByID(ov.Doses, targetID)
	if dScheduled == nil || dScheduled.Status != vaccines.StatusScheduled || dScheduled.ScheduledDate == nil || *dScheduled.ScheduledDate != "2026-11-28" {
		t.Fatalf("expected persisted scheduled dose, got %+v", dScheduled)
	}

	resp = env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", targetID), map[string]any{
		"status":        "completed",
		"vaccinated_at": "2026-11-24", // 晚于 fixedNow 本地自然日 2026-11-23
	}, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for future vaccinated_at, got %d", resp.StatusCode)
	}

	resp = env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", targetID), map[string]any{
		"status":        "completed",
		"vaccinated_at": "2020-01-01", // 早于宝宝出生日期
	}, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for vaccinated_at before birth_date, got %d", resp.StatusCode)
	}

	resp = env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", targetID), map[string]any{
		"status":        "completed",
		"vaccinated_at": "2026-11-23",
		"clinic_name":   "城西社区卫生服务中心",
		"site":          "右上臂",
		"manufacturer":  "沃森生物",
		"batch_no":      "P202611",
		"reaction":      "轻微嗜睡",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 complete dose, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	ov = fetchOverview(t, env)
	dCompleted := findDoseByID(ov.Doses, targetID)
	if dCompleted == nil || dCompleted.Status != vaccines.StatusCompleted || dCompleted.ScheduledDate != nil || dCompleted.Site != "右上臂" {
		t.Fatalf("expected persisted completed dose with cleared schedule, got %+v", dCompleted)
	}
	if !slices.Contains(ov.RecentClinics, "城西社区卫生服务中心") {
		t.Fatalf("expected recent_clinics to contain 城西社区卫生服务中心, got %v", ov.RecentClinics)
	}

	// 7. 删除中间剂次自动重排、整套模板移出与 NIP 删除拦截
	// 删除 pcv13 第 2 剂（9月龄），原第 3 剂（12月龄）自动前移为第 2/2 剂。
	resp = env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/vaccines/%d", addedTpl.Doses[1].ID), nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 deleting middle pcv13 dose, got %d", resp.StatusCode)
	}
	ov = fetchOverview(t, env)
	dThirdShifted := findDoseByID(ov.Doses, addedTpl.Doses[2].ID)
	if dThirdShifted == nil || dThirdShifted.DoseNumber != 2 || dThirdShifted.TotalDoses != 2 {
		t.Fatalf("expected pcv13 dose #3 renumbered to 2/2, got %+v", dThirdShifted)
	}

	// 整套移出 pcv13，验证目录恢复 added=false 且所有 pcv13 剂次移除
	resp = env.doJSON(t, http.MethodDelete, "/api/vaccines/template/pcv13", nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 removing pcv13 template, got %d", resp.StatusCode)
	}
	ov = fetchOverview(t, env)
	if findDoseByID(ov.Doses, addedTpl.Doses[0].ID) != nil || findDoseByID(ov.Doses, addedTpl.Doses[2].ID) != nil {
		t.Fatalf("expected all pcv13 doses removed after template deletion")
	}
	cat = fetchCatalog(t, env)
	for _, tpl := range cat.Templates {
		if tpl.Code == "pcv13" && tpl.Added {
			t.Fatalf("expected pcv13 catalog added=false after template removal")
		}
	}

	// 删除自定义第 1 剂，原第 2 剂自动变为 1/1
	resp = env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/vaccines/%d", createdCustom.Doses[0].ID), nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 deleting custom dose #1, got %d", resp.StatusCode)
	}
	ov = fetchOverview(t, env)
	customRem := findDoseByID(ov.Doses, createdCustom.Doses[1].ID)
	if customRem == nil || customRem.DoseNumber != 1 || customRem.TotalDoses != 1 {
		t.Fatalf("expected remaining custom dose renumbered to 1/1, got %+v", customRem)
	}

	// 拒绝删除内置 NIP 剂次及内置 NIP 模板
	nipDoseID := ov.Doses[0].ID
	resp = env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/vaccines/%d", nipDoseID), nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 rejecting NIP dose deletion, got %d", resp.StatusCode)
	}
	resp = env.doJSON(t, http.MethodDelete, "/api/vaccines/template/hepb", nil, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 rejecting NIP template deletion, got %d", resp.StatusCode)
	}
	ov = fetchOverview(t, env)
	if findDoseByID(ov.Doses, nipDoseID) == nil {
		t.Fatalf("expected protected NIP dose to remain in DB")
	}
}

func TestDefaultClinicEndpointsAndAutoRemember(t *testing.T) {
	env := setupFullTestServer(t, func() time.Time { return fixedNow })
	env.createDefaultBaby(t)

	// 1. 首次获取疫苗总览与宝宝档案：默认常去门诊均为空字符串。
	ov := fetchOverview(t, env)
	if ov.DefaultClinicName != "" {
		t.Fatalf("expected initial default_clinic_name empty, got %q", ov.DefaultClinicName)
	}

	// 2. 通过 PUT /api/vaccines/default-clinic 显式设置、拒绝超长名称与清空，并验证与 GET /api/baby 同步。
	resp := env.doJSON(t, http.MethodPut, "/api/vaccines/default-clinic", map[string]any{
		"clinic_name": "  阳光街道社区卫生服务中心  ",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 setting default clinic, got %d", resp.StatusCode)
	}
	setBody := decodeJSONMap(t, resp)
	if setBody["default_clinic_name"] != "阳光街道社区卫生服务中心" {
		t.Fatalf("unexpected default clinic response: %#v", setBody)
	}

	ov = fetchOverview(t, env)
	if ov.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected overview default_clinic_name updated, got %q", ov.DefaultClinicName)
	}

	babyResp := env.doJSON(t, http.MethodGet, "/api/baby", nil, true)
	if babyResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 GET /api/baby, got %d", babyResp.StatusCode)
	}
	babyObj, _ := decodeJSONMap(t, babyResp)["baby"].(map[string]any)
	if babyObj["default_clinic_name"] != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected GET /api/baby default_clinic_name synced, got %#v", babyObj["default_clinic_name"])
	}

	// PUT /api/baby 省略 default_clinic_name 保留原值；传入超长返回 400。
	updPreserve := env.doJSON(t, http.MethodPut, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":   "小汤圆",
		"birth_date": "2026-07-15",
		"gender":     "female",
	}, true)
	if updPreserve.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 PUT /api/baby preserve clinic, got %d", updPreserve.StatusCode)
	}
	updPreserveBaby, _ := decodeJSONMap(t, updPreserve)["baby"].(map[string]any)
	if updPreserveBaby["default_clinic_name"] != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected PUT /api/baby omitting default_clinic_name to preserve it, got %#v", updPreserveBaby["default_clinic_name"])
	}

	overResp := env.doJSON(t, http.MethodPut, "/api/vaccines/default-clinic", map[string]any{
		"clinic_name": strings.Repeat("院", 81),
	}, true)
	_ = overResp.Body.Close()
	if overResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized default clinic, got %d", overResp.StatusCode)
	}

	// 清空默认门诊后，常规剂次预约应自动记住新门诊；显式 set_default_clinic=true 可覆写。
	clearResp := env.doJSON(t, http.MethodPut, "/api/vaccines/default-clinic", map[string]any{
		"clinic_name": "",
	}, true)
	if clearResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 clearing default clinic, got %d", clearResp.StatusCode)
	}
	_ = clearResp.Body.Close()

	var routineDoseID int64
	for _, d := range ov.Doses {
		if d.AgeMonths >= 1 {
			routineDoseID = d.ID
			break
		}
	}
	resp = env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", routineDoseID), map[string]any{
		"status":         "scheduled",
		"scheduled_date": "2026-11-28",
		"clinic_name":    "城北社区卫生服务中心",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 scheduling routine dose, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	ov = fetchOverview(t, env)
	if ov.DefaultClinicName != "城北社区卫生服务中心" {
		t.Fatalf("expected auto-remembered default_clinic_name 城北社区卫生服务中心, got %q", ov.DefaultClinicName)
	}

	resp = env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/vaccines/%d?tz=Asia/Shanghai", routineDoseID), map[string]any{
		"status":             "scheduled",
		"scheduled_date":     "2026-11-29",
		"clinic_name":        "城南社区卫生服务中心",
		"set_default_clinic": true,
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 explicit pin on dose update, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	ov = fetchOverview(t, env)
	if ov.DefaultClinicName != "城南社区卫生服务中心" {
		t.Fatalf("expected explicitly pinned default_clinic_name 城南社区卫生服务中心, got %q", ov.DefaultClinicName)
	}
}
