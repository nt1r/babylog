package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/httpapi"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// fixedNow 固定在 2026-11-23 10:00:00+08:00（2026-11-23 02:00:00Z），便于确定性验证跨零点与跨夜统计。
var fixedNow = time.Date(2026, 11, 23, 2, 0, 0, 0, time.UTC)

type fullTestEnv struct {
	ts           *httptest.Server
	client       *http.Client
	sessionToken string
}

func setupFullTestServer(t *testing.T, clock func() time.Time) *fullTestEnv {
	t.Helper()

	dataDir := filepath.Join(t.TempDir(), "data")
	db, err := database.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	authStore := auth.NewStore(db.Gorm())
	if err := authStore.InitializeAdministrator(context.Background(), testAdminUser, testAdminPass); err != nil {
		t.Fatalf("init admin: %v", err)
	}

	babyStore := baby.NewStore(db.Gorm())
	recordStore := records.NewStore(db.Gorm())
	dashSvc := dashboard.NewService(recordStore)
	vaccineStore := vaccines.NewStore(db.Gorm())
	if clock != nil {
		babyStore.WithClock(clock)
		recordStore.WithClock(clock)
		dashSvc.WithClock(clock)
		vaccineStore.WithClock(clock)
	}

	router := httpapi.NewRouter(httpapi.Options{
		Store:        authStore,
		BabyStore:    babyStore,
		RecordStore:  recordStore,
		DashboardSvc: dashSvc,
		VaccineStore: vaccineStore,
	})
	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)

	env := &fullTestEnv{ts: ts, client: ts.Client()}
	env.sessionToken = env.login(t)
	return env
}

func (e *fullTestEnv) login(t *testing.T) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"username": testAdminUser, "password": testAdminPass})
	req, _ := http.NewRequest(http.MethodPost, e.ts.URL+"/api/auth/login", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", e.ts.URL)
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 login, got %d", resp.StatusCode)
	}
	return strings.SplitN(resp.Header.Get("Set-Cookie"), ";", 2)[0]
}

func (e *fullTestEnv) doJSON(t *testing.T, method, path string, body any, authenticated bool) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, e.ts.URL+path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("Origin", e.ts.URL)
	}
	if authenticated {
		req.Header.Set("Cookie", e.sessionToken)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("%s %s failed: %v", method, path, err)
	}
	return resp
}

func (e *fullTestEnv) createDefaultBaby(t *testing.T) {
	t.Helper()
	resp := e.doJSON(t, http.MethodPost, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":        "小汤圆",
		"birth_date":      "2026-07-15",
		"gender":          "female",
		"birth_weight_kg": 3.35,
		"birth_height_cm": 50.2,
	}, true)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 creating baby, got %d", resp.StatusCode)
	}
}

func TestBabyProfileLifecycleAndAuthGuards(t *testing.T) {
	env := setupFullTestServer(t, func() time.Time { return fixedNow })

	// 1. 未认证访问受保护业务接口全部返回 401。
	unauthEndpoints := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/baby", nil},
		{http.MethodPost, "/api/baby", map[string]any{"nickname": "宝", "birth_date": "2026-07-01", "gender": "male"}},
		{http.MethodPut, "/api/baby", map[string]any{"nickname": "宝", "birth_date": "2026-07-01", "gender": "male"}},
		{http.MethodGet, "/api/records/feeding", nil},
		{http.MethodGet, "/api/records/defaults", nil},
		{http.MethodGet, "/api/dashboard/summary", nil},
		{http.MethodGet, "/api/dashboard/trends", nil},
	}
	for _, ep := range unauthEndpoints {
		resp := env.doJSON(t, ep.method, ep.path, ep.body, false)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without auth expected 401, got %d", ep.method, ep.path, resp.StatusCode)
		}
	}

	// 2. 初始未建档：GET /api/baby 返回 {baby: null}，PUT /api/baby 返回 404。
	getResp := env.doJSON(t, http.MethodGet, "/api/baby", nil, true)
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on empty GET /api/baby, got %d", getResp.StatusCode)
	}
	getBody := decodeJSONMap(t, getResp)
	if getBody["baby"] != nil {
		t.Fatalf("expected baby=nil before onboarding, got %#v", getBody["baby"])
	}

	putBeforeResp := env.doJSON(t, http.MethodPut, "/api/baby", map[string]any{
		"nickname": "团子", "birth_date": "2026-07-15", "gender": "male",
	}, true)
	_ = putBeforeResp.Body.Close()
	if putBeforeResp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 updating missing baby, got %d", putBeforeResp.StatusCode)
	}

	// 未建档写入记录与访问看板均返回 409。
	preRecordResp := env.doJSON(t, http.MethodPost, "/api/records/feeding", map[string]any{
		"subtype": "formula", "amount_ml": 120, "recorded_at": "2026-11-23T01:00:00Z",
	}, true)
	_ = preRecordResp.Body.Close()
	if preRecordResp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 writing feeding before onboarding, got %d", preRecordResp.StatusCode)
	}

	preDashResp := env.doJSON(t, http.MethodGet, "/api/dashboard/summary", nil, true)
	_ = preDashResp.Body.Close()
	if preDashResp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 reading dashboard before onboarding, got %d", preDashResp.StatusCode)
	}

	// 3. 创建宝宝档案（201），再次创建返回 409。
	createResp := env.doJSON(t, http.MethodPost, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":   "小汤圆",
		"birth_date": "2026-07-15",
		"gender":     "female",
	}, true)
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 creating baby, got %d", createResp.StatusCode)
	}
	createBody := decodeJSONMap(t, createResp)
	createdBaby, _ := createBody["baby"].(map[string]any)
	if createdBaby["nickname"] != "小汤圆" || createdBaby["gender"] != "female" {
		t.Fatalf("unexpected created baby: %#v", createdBaby)
	}

	dupResp := env.doJSON(t, http.MethodPost, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":   "二宝",
		"birth_date": "2026-08-01",
		"gender":     "male",
	}, true)
	_ = dupResp.Body.Close()
	if dupResp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 on duplicate baby, got %d", dupResp.StatusCode)
	}

	// 4. 更新宝宝档案（200）并持久化：验证 default_clinic_name 的设置、省略保留、空串清空与超长（>80 字）400 拦截。
	updResp := env.doJSON(t, http.MethodPut, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":            "大汤圆",
		"birth_date":          "2026-07-15",
		"gender":              "female",
		"birth_weight_kg":     3.45,
		"default_clinic_name": "  阳光街道社区卫生服务中心  ",
	}, true)
	if updResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 updating baby, got %d", updResp.StatusCode)
	}
	updBody := decodeJSONMap(t, updResp)
	updBaby, _ := updBody["baby"].(map[string]any)
	if updBaby["nickname"] != "大汤圆" || updBaby["birth_weight_kg"] != 3.45 || updBaby["default_clinic_name"] != "阳光街道社区卫生服务中心" {
		t.Fatalf("unexpected updated baby: %#v", updBaby)
	}

	// 省略 default_clinic_name 时保留原值。
	keepClinicResp := env.doJSON(t, http.MethodPut, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":   "大汤圆",
		"birth_date": "2026-07-15",
		"gender":     "female",
	}, true)
	if keepClinicResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 preserving default_clinic_name, got %d", keepClinicResp.StatusCode)
	}
	keepBaby, _ := decodeJSONMap(t, keepClinicResp)["baby"].(map[string]any)
	if keepBaby["default_clinic_name"] != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected default_clinic_name preserved on omit, got %#v", keepBaby["default_clinic_name"])
	}

	// 传入空串显式清空并经 GET /api/baby 回读验证终态。
	clearClinicResp := env.doJSON(t, http.MethodPut, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":            "大汤圆",
		"birth_date":          "2026-07-15",
		"gender":              "female",
		"default_clinic_name": "",
	}, true)
	if clearClinicResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 clearing default_clinic_name, got %d", clearClinicResp.StatusCode)
	}
	_ = clearClinicResp.Body.Close()
	afterClearResp := env.doJSON(t, http.MethodGet, "/api/baby", nil, true)
	afterClearBaby, _ := decodeJSONMap(t, afterClearResp)["baby"].(map[string]any)
	if afterClearBaby["default_clinic_name"] != "" {
		t.Fatalf("expected empty default_clinic_name after clear, got %#v", afterClearBaby["default_clinic_name"])
	}

	// 超过 80 字符返回 400 中文错误。
	overClinicResp := env.doJSON(t, http.MethodPut, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":            "大汤圆",
		"birth_date":          "2026-07-15",
		"gender":              "female",
		"default_clinic_name": strings.Repeat("医", 81),
	}, true)
	if overClinicResp.StatusCode != http.StatusBadRequest {
		_ = overClinicResp.Body.Close()
		t.Fatalf("expected 400 for oversized default_clinic_name on PUT /api/baby, got %d", overClinicResp.StatusCode)
	}
	overErrBody := decodeJSONMap(t, overClinicResp)
	if errMsg, _ := overErrBody["error"].(string); !strings.Contains(errMsg, "80") {
		t.Fatalf("expected Chinese length error for PUT /api/baby, got %#v", overErrBody)
	}
}

func TestRecordsCRUDFilteringPaginationAndSmartDefaults(t *testing.T) {
	env := setupFullTestServer(t, func() time.Time { return fixedNow })
	env.createDefaultBaby(t)

	// 0. 写操作安全防护：跨源 403、非 JSON 415、超大载荷 413。
	crossReq, _ := http.NewRequest(http.MethodPost, env.ts.URL+"/api/records/feeding",
		strings.NewReader(`{"subtype":"formula","amount_ml":100,"recorded_at":"2026-11-23T01:00:00Z"}`))
	crossReq.Header.Set("Content-Type", "application/json")
	crossReq.Header.Set("Origin", "http://evil.example")
	crossReq.Header.Set("Cookie", env.sessionToken)
	crossResp, err := env.client.Do(crossReq)
	if err != nil {
		t.Fatalf("cross origin feeding: %v", err)
	}
	_ = crossResp.Body.Close()
	if crossResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 cross-origin feeding, got %d", crossResp.StatusCode)
	}

	badCTReq, _ := http.NewRequest(http.MethodPost, env.ts.URL+"/api/records/feeding", strings.NewReader("subtype=formula"))
	badCTReq.Header.Set("Content-Type", "text/plain")
	badCTReq.Header.Set("Origin", env.ts.URL)
	badCTReq.Header.Set("Cookie", env.sessionToken)
	badCTResp, _ := env.client.Do(badCTReq)
	_ = badCTResp.Body.Close()
	if badCTResp.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415 wrong content type, got %d", badCTResp.StatusCode)
	}

	bigPayload, _ := json.Marshal(map[string]any{
		"subtype":     "formula",
		"amount_ml":   100,
		"recorded_at": "2026-11-23T01:00:00Z",
		"note":        strings.Repeat("a", 70*1024),
	})
	bigReq, _ := http.NewRequest(http.MethodPost, env.ts.URL+"/api/records/feeding", bytes.NewReader(bigPayload))
	bigReq.Header.Set("Content-Type", "application/json")
	bigReq.Header.Set("Origin", env.ts.URL)
	bigReq.Header.Set("Cookie", env.sessionToken)
	bigResp, _ := env.client.Do(bigReq)
	_ = bigResp.Body.Close()
	if bigResp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 oversized payload, got %d", bigResp.StatusCode)
	}

	// 1. 空历史下的智能默认值返回合理兜底。
	emptyDefResp := env.doJSON(t, http.MethodGet, "/api/records/defaults", nil, true)
	if emptyDefResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 empty defaults, got %d", emptyDefResp.StatusCode)
	}
	var emptyDef records.SmartDefaults
	if err := json.NewDecoder(emptyDefResp.Body).Decode(&emptyDef); err != nil {
		t.Fatalf("decode empty defaults: %v", err)
	}
	_ = emptyDefResp.Body.Close()
	if emptyDef.Feeding.LastMilkML != 90 || emptyDef.Health.LastTemperatureC != 36.6 {
		t.Fatalf("unexpected starter defaults: %+v", emptyDef)
	}

	// 2. Feeding CRUD + 分页不受截断的每日小计。
	feedingPayloads := []map[string]any{
		{"subtype": "formula", "amount_ml": 120, "recorded_at": "2026-11-23T01:00:00Z"},                                                   // 09:00+08
		{"subtype": "formula", "amount_ml": 150, "recorded_at": "2026-11-22T17:00:00Z"},                                                   // 2026-11-23 01:00+08 (本地今天!)
		{"subtype": "formula", "amount_ml": 120, "recorded_at": "2026-11-22T10:00:00Z"},                                                   // 2026-11-22 18:00+08
		{"subtype": "breast", "feeding_mode": "direct", "breast_side": "left", "duration_min": 18, "recorded_at": "2026-11-23T00:00:00Z"}, // 08:00+08
		{"subtype": "solid", "solid_food": "高铁米粉", "solid_amount": "半碗", "acceptance": "like", "recorded_at": "2026-11-22T04:00:00Z"},
	}
	var firstFeedID int64
	for idx, p := range feedingPayloads {
		resp := env.doJSON(t, http.MethodPost, "/api/records/feeding", p, true)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("feeding %d expected 201, got %d", idx, resp.StatusCode)
		}
		m := decodeJSONMap(t, resp)
		rec := m["record"].(map[string]any)
		if idx == 0 {
			firstFeedID = int64(rec["id"].(float64))
		}
	}

	// 按 formula 筛选 + limit=1 分页：第一页只返回 1 条（120 ml），但 2026-11-23 当日小计必须完整为 120+150=270 ml！
	listResp := env.doJSON(t, http.MethodGet, "/api/records/feeding?subtype=formula&range=7d&tz=Asia/Shanghai&limit=1&offset=0", nil, true)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list feeding expected 200, got %d", listResp.StatusCode)
	}
	var feedList records.ListResult[records.FeedingRecord, records.FeedingDailySummary]
	if err := json.NewDecoder(listResp.Body).Decode(&feedList); err != nil {
		t.Fatalf("decode feeding list: %v", err)
	}
	_ = listResp.Body.Close()
	if feedList.Total != 3 || !feedList.HasMore || len(feedList.Items) != 1 {
		t.Fatalf("unexpected feeding pagination: total=%d hasMore=%v len=%d", feedList.Total, feedList.HasMore, len(feedList.Items))
	}
	if sum := feedList.DailySummaries["2026-11-23"]; sum.TotalML != 270 || sum.TotalCount != 2 {
		t.Fatalf("expected non-truncated 2026-11-23 summary 270ml/2, got %+v", sum)
	}

	// 更新与删除 Feeding，并对不存在 ID 返回 404。
	updFeedResp := env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/records/feeding/%d", firstFeedID), map[string]any{
		"subtype": "formula", "amount_ml": 130, "recorded_at": "2026-11-23T01:00:00Z", "note": "全喝完了",
	}, true)
	if updFeedResp.StatusCode != http.StatusOK {
		t.Fatalf("update feeding expected 200, got %d", updFeedResp.StatusCode)
	}
	_ = updFeedResp.Body.Close()

	delFeedResp := env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/records/feeding/%d", firstFeedID), nil, true)
	if delFeedResp.StatusCode != http.StatusOK {
		t.Fatalf("delete feeding expected 200, got %d", delFeedResp.StatusCode)
	}
	_ = delFeedResp.Body.Close()

	missingDelResp := env.doJSON(t, http.MethodDelete, "/api/records/feeding/999999", nil, true)
	_ = missingDelResp.Body.Close()
	if missingDelResp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 deleting missing feeding, got %d", missingDelResp.StatusCode)
	}

	// 3. Sleep CRUD
	sleepCreate := env.doJSON(t, http.MethodPost, "/api/records/sleep", map[string]any{
		"subtype":    "nap",
		"started_at": "2026-11-23T00:15:00Z",
		"ended_at":   "2026-11-23T01:00:00Z",
	}, true)
	if sleepCreate.StatusCode != http.StatusCreated {
		t.Fatalf("create sleep expected 201, got %d", sleepCreate.StatusCode)
	}
	sleepMap := decodeJSONMap(t, sleepCreate)["record"].(map[string]any)
	sleepID := int64(sleepMap["id"].(float64))
	if int(sleepMap["duration_min"].(float64)) != 45 {
		t.Fatalf("expected sleep duration 45, got %v", sleepMap["duration_min"])
	}
	sleepUpd := env.doJSON(t, http.MethodPut, fmt.Sprintf("/api/records/sleep/%d", sleepID), map[string]any{
		"subtype":    "nap",
		"started_at": "2026-11-23T00:00:00Z",
		"ended_at":   "2026-11-23T01:00:00Z",
	}, true)
	if sleepUpd.StatusCode != http.StatusOK {
		t.Fatalf("update sleep expected 200, got %d", sleepUpd.StatusCode)
	}
	_ = sleepUpd.Body.Close()
	sleepDel := env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/records/sleep/%d", sleepID), nil, true)
	if sleepDel.StatusCode != http.StatusOK {
		t.Fatalf("delete sleep expected 200, got %d", sleepDel.StatusCode)
	}
	_ = sleepDel.Body.Close()

	// 追加保留的 45 分钟小睡与 570 分钟夜觉记录，用于验证 /api/records/defaults 的 sleep 习惯时长字段。
	for _, sl := range []map[string]any{
		{"subtype": "nap", "started_at": "2026-11-23T00:15:00Z", "ended_at": "2026-11-23T01:00:00Z"},
		{"subtype": "night", "started_at": "2026-11-22T13:00:00Z", "ended_at": "2026-11-22T22:30:00Z"},
	} {
		sleepKeep := env.doJSON(t, http.MethodPost, "/api/records/sleep", sl, true)
		if sleepKeep.StatusCode != http.StatusCreated {
			t.Fatalf("create kept sleep %v expected 201, got %d", sl["subtype"], sleepKeep.StatusCode)
		}
		_ = sleepKeep.Body.Close()
	}

	// 4. Care CRUD
	careCreate := env.doJSON(t, http.MethodPost, "/api/records/care", map[string]any{
		"subtype":           "diaper",
		"diaper_kind":       "poop",
		"stool_consistency": "soft",
		"stool_color":       "yellow",
		"recorded_at":       "2026-11-23T01:10:00Z",
	}, true)
	if careCreate.StatusCode != http.StatusCreated {
		t.Fatalf("create care expected 201, got %d", careCreate.StatusCode)
	}
	careID := int64(decodeJSONMap(t, careCreate)["record"].(map[string]any)["id"].(float64))
	_ = env.doJSON(t, http.MethodPost, "/api/records/care", map[string]any{
		"subtype":     "other",
		"care_title":  "剪指甲",
		"recorded_at": "2026-11-23T01:20:00Z",
	}, true).Body.Close()

	careDel := env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/records/care/%d", careID), nil, true)
	if careDel.StatusCode != http.StatusOK {
		t.Fatalf("delete care expected 200, got %d", careDel.StatusCode)
	}
	_ = careDel.Body.Close()

	// 5. Health CRUD
	tempCreate := env.doJSON(t, http.MethodPost, "/api/records/health", map[string]any{
		"subtype":       "temperature",
		"temperature_c": 37.4,
		"recorded_at":   "2026-11-23T01:05:00Z",
	}, true)
	if tempCreate.StatusCode != http.StatusCreated {
		t.Fatalf("create temp expected 201, got %d", tempCreate.StatusCode)
	}
	_ = tempCreate.Body.Close()

	medCreate := env.doJSON(t, http.MethodPost, "/api/records/health", map[string]any{
		"subtype":         "medicine",
		"medicine_name":   "维生素 D3",
		"medicine_dosage": "1 粒",
		"recorded_at":     "2026-11-23T01:15:00Z",
	}, true)
	if medCreate.StatusCode != http.StatusCreated {
		t.Fatalf("create medicine expected 201, got %d", medCreate.StatusCode)
	}
	_ = medCreate.Body.Close()

	growthCreate := env.doJSON(t, http.MethodPost, "/api/records/health", map[string]any{
		"subtype":     "growth",
		"weight_kg":   6.9,
		"recorded_at": "2026-11-23T01:25:00Z",
	}, true)
	if growthCreate.StatusCode != http.StatusCreated {
		t.Fatalf("create growth expected 201, got %d", growthCreate.StatusCode)
	}
	growthID := int64(decodeJSONMap(t, growthCreate)["record"].(map[string]any)["id"].(float64))
	growthDel := env.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/records/health/%d", growthID), nil, true)
	if growthDel.StatusCode != http.StatusOK {
		t.Fatalf("delete growth expected 200, got %d", growthDel.StatusCode)
	}
	_ = growthDel.Body.Close()

	// 6. 有历史记录后的智能默认值验证：上次亲喂为 left -> 推荐 right，最近体温 37.4，常用药包含 维生素 D3，常用辅食 高铁米粉。
	defResp := env.doJSON(t, http.MethodGet, "/api/records/defaults", nil, true)
	if defResp.StatusCode != http.StatusOK {
		t.Fatalf("get defaults expected 200, got %d", defResp.StatusCode)
	}
	var def records.SmartDefaults
	if err := json.NewDecoder(defResp.Body).Decode(&def); err != nil {
		t.Fatalf("decode defaults: %v", err)
	}
	_ = defResp.Body.Close()
	if def.Feeding.LastMilkML != 150 || def.Feeding.LastMilkSubtype != records.FeedingSubtypeBreast {
		t.Errorf("expected last_milk_ml=150 and last_milk_subtype=breast, got ml=%d subtype=%q", def.Feeding.LastMilkML, def.Feeding.LastMilkSubtype)
	}
	if def.Feeding.LastBreastMode != "direct" || def.Feeding.LastBreastDurationMin != 18 {
		t.Errorf("unexpected breast mode/duration defaults: mode=%q dur=%d", def.Feeding.LastBreastMode, def.Feeding.LastBreastDurationMin)
	}
	if def.Feeding.LastBreastSide == nil || *def.Feeding.LastBreastSide != "left" || def.Feeding.SuggestedBreastSide != "right" {
		t.Errorf("unexpected breast side defaults: last=%v suggested=%s", def.Feeding.LastBreastSide, def.Feeding.SuggestedBreastSide)
	}
	if len(def.Feeding.RecentSolids) != 1 || def.Feeding.RecentSolids[0].Food != "高铁米粉" || def.Feeding.RecentSolids[0].Amount != "半碗" {
		t.Errorf("unexpected paired recent solids: %#v", def.Feeding.RecentSolids)
	}
	if def.Sleep.SuggestedNapMin != 45 || def.Sleep.SuggestedNightMin != 570 {
		t.Errorf("unexpected sleep defaults (expected nap=45, night=570): %+v", def.Sleep)
	}
	if def.Health.LastTemperatureC != 37.4 {
		t.Errorf("expected last_temperature_c=37.4, got %v", def.Health.LastTemperatureC)
	}
	if len(def.Health.RecentMedicines) != 1 || def.Health.RecentMedicines[0].Name != "维生素 D3" {
		t.Errorf("unexpected recent medicines: %#v", def.Health.RecentMedicines)
	}
	if len(def.Care.RecentOtherTitles) != 1 || def.Care.RecentOtherTitles[0] != "剪指甲" {
		t.Errorf("unexpected recent other titles: %#v", def.Care.RecentOtherTitles)
	}
}

func TestDashboardTimezoneSummaryAndCrossMidnightTrends(t *testing.T) {
	env := setupFullTestServer(t, func() time.Time { return fixedNow })
	env.createDefaultBaby(t)

	// 非法时区返回 400。
	badTZResp := env.doJSON(t, http.MethodGet, "/api/dashboard/summary?tz=Invalid/Zone", nil, true)
	_ = badTZResp.Body.Close()
	if badTZResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid timezone, got %d", badTZResp.StatusCode)
	}

	// 写入跨 UTC 日界线的本地凌晨喂养：2026-11-23T00:30:00+08:00 == 2026-11-22T16:30:00Z
	resp := env.doJSON(t, http.MethodPost, "/api/records/feeding", map[string]any{
		"subtype":     "formula",
		"amount_ml":   120,
		"recorded_at": "2026-11-22T16:30:00Z",
	}, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 feeding, got %d", resp.StatusCode)
	}

	// 写入两条当日亲喂记录（含一条跨 UTC 日界线的本地凌晨记录 00:40+08 与一条 09:30+08）
	for _, p := range []map[string]any{
		{
			"subtype":      "breast",
			"feeding_mode": "direct",
			"breast_side":  "left",
			"duration_min": 18,
			"recorded_at":  "2026-11-22T16:40:00Z",
		},
		{
			"subtype":      "breast",
			"feeding_mode": "direct",
			"breast_side":  "right",
			"duration_min": 12,
			"recorded_at":  "2026-11-23T01:30:00Z",
		},
	} {
		r := env.doJSON(t, http.MethodPost, "/api/records/feeding", p, true)
		_ = r.Body.Close()
		if r.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 direct breast feeding, got %d", r.StatusCode)
		}
	}

	// 写入跨夜睡眠：2026-11-22T22:00:00+08:00 (14:00Z) -> 2026-11-23T06:00:00+08:00 (22:00Z)
	resp = env.doJSON(t, http.MethodPost, "/api/records/sleep", map[string]any{
		"subtype":    "night",
		"started_at": "2026-11-22T14:00:00Z",
		"ended_at":   "2026-11-22T22:00:00Z",
	}, true)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 cross-midnight sleep, got %d", resp.StatusCode)
	}

	// 写入今日换尿布与体温
	_ = env.doJSON(t, http.MethodPost, "/api/records/care", map[string]any{
		"subtype":     "diaper",
		"diaper_kind": "both",
		"recorded_at": "2026-11-23T01:00:00Z", // 09:00+08 (上午)
	}, true).Body.Close()

	_ = env.doJSON(t, http.MethodPost, "/api/records/health", map[string]any{
		"subtype":       "temperature",
		"temperature_c": 36.7,
		"recorded_at":   "2026-11-23T01:10:00Z", // 09:10+08 (上午)
	}, true).Body.Close()

	// 1. 验证 GET /api/dashboard/summary?tz=Asia/Shanghai
	sumResp := env.doJSON(t, http.MethodGet, "/api/dashboard/summary?tz=Asia/Shanghai", nil, true)
	if sumResp.StatusCode != http.StatusOK {
		t.Fatalf("summary expected 200, got %d", sumResp.StatusCode)
	}
	var sum dashboard.SummaryResponse
	if err := json.NewDecoder(sumResp.Body).Decode(&sum); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	_ = sumResp.Body.Close()

	if sum.Date != "2026-11-23" {
		t.Errorf("expected summary date 2026-11-23, got %s", sum.Date)
	}
	if sum.Feeding.TotalML != 120 || sum.Feeding.DirectBreastCount != 2 || sum.Feeding.DirectBreastMin != 30 ||
		sum.Feeding.LastFeedingAt == nil || *sum.Feeding.LastFeedingAt != "2026-11-23T01:30:00Z" {
		t.Errorf("unexpected feeding summary: %+v", sum.Feeding)
	}
	if sum.Sleep.TotalMin != 360 || sum.Sleep.NightMin != 360 {
		t.Errorf("expected today split sleep 360 min, got %+v", sum.Sleep)
	}
	if sum.Health.LatestTempC == nil || *sum.Health.LatestTempC != 36.7 {
		t.Errorf("unexpected health summary: %+v", sum.Health)
	}
	if sum.Care.TotalCount != 1 || sum.Care.PeeCount != 1 || sum.Care.PoopCount != 1 || sum.Care.LastDiaperAt == nil {
		t.Errorf("unexpected care summary: %+v", sum.Care)
	}

	// 2. 验证 GET /api/dashboard/trends?days=7&tz=Asia/Shanghai
	trResp := env.doJSON(t, http.MethodGet, "/api/dashboard/trends?days=7&tz=Asia/Shanghai", nil, true)
	if trResp.StatusCode != http.StatusOK {
		t.Fatalf("trends expected 200, got %d", trResp.StatusCode)
	}
	var tr dashboard.TrendsResponse
	if err := json.NewDecoder(trResp.Body).Decode(&tr); err != nil {
		t.Fatalf("decode trends: %v", err)
	}
	_ = trResp.Body.Close()

	if len(tr.Daily) != 7 {
		t.Fatalf("expected 7 daily points, got %d", len(tr.Daily))
	}
	// 前 5 天空日为 0，倒数第 2 天（2026-11-22）睡眠 2.0h，最后一天（2026-11-23）奶量 120ml + 亲喂 30分/2次 + 睡眠 6.0h。
	for i := 0; i < 5; i++ {
		if tr.Daily[i].FeedingML != 0 || tr.Daily[i].DirectBreastMin != 0 || tr.Daily[i].DirectBreastCount != 0 || tr.Daily[i].SleepHours != 0 {
			t.Errorf("expected zero-filled day %s, got %+v", tr.Daily[i].Date, tr.Daily[i])
		}
	}
	dayPrev := tr.Daily[5]
	dayToday := tr.Daily[6]
	if dayPrev.Date != "2026-11-22" || dayPrev.SleepHours != 2.0 || dayPrev.FeedingML != 0 || dayPrev.DirectBreastMin != 0 || dayPrev.DirectBreastCount != 0 {
		t.Errorf("unexpected 2026-11-22 trend: %+v", dayPrev)
	}
	if dayToday.Date != "2026-11-23" || dayToday.SleepHours != 6.0 || dayToday.FeedingML != 120 || dayToday.DirectBreastMin != 30 || dayToday.DirectBreastCount != 2 {
		t.Errorf("unexpected 2026-11-23 trend: %+v", dayToday)
	}

	// 5 个时段有序返回：凌晨配方奶(00:30 夜间) + 凌晨亲喂(00:40 夜间) + 入睡(22:00 夜间) + 尿布(09:00 上午) + 体温(09:10 上午) + 亲喂(09:30 上午)
	if len(tr.Slots) != 5 {
		t.Fatalf("expected 5 slots, got %d", len(tr.Slots))
	}
	slotMap := map[string]int{}
	for _, s := range tr.Slots {
		slotMap[s.Slot] = s.Count
	}
	if slotMap["夜间"] != 3 || slotMap["上午"] != 3 {
		t.Errorf("unexpected slot counts: %+v", tr.Slots)
	}
}

func TestHealthMultiSubtypeFilterAndDashboardGrowthSummary(t *testing.T) {
	env := setupFullTestServer(t, func() time.Time { return fixedNow })
	env.createDefaultBaby(t) // birth_date=2026-07-15, birth_weight_kg=3.35, birth_height_cm=50.2

	// 1. 尚无手动生长记录时，看板摘要应使用出生体重/身高兜底
	initResp := env.doJSON(t, http.MethodGet, "/api/dashboard/summary?tz=Asia/Shanghai", nil, true)
	if initResp.StatusCode != http.StatusOK {
		t.Fatalf("initial summary expected 200, got %d", initResp.StatusCode)
	}
	var initSum dashboard.SummaryResponse
	if err := json.NewDecoder(initResp.Body).Decode(&initSum); err != nil {
		t.Fatalf("decode initial summary: %v", err)
	}
	_ = initResp.Body.Close()
	if initSum.Growth.LatestWeightKg == nil || *initSum.Growth.LatestWeightKg != 3.35 || !initSum.Growth.WeightIsBirth ||
		initSum.Growth.LatestHeightCm == nil || *initSum.Growth.LatestHeightCm != 50.2 || !initSum.Growth.HeightIsBirth ||
		initSum.Growth.LatestHeadCm != nil || initSum.Growth.TeethCount != 0 {
		t.Fatalf("unexpected initial birth-fallback growth summary: %+v", initSum.Growth)
	}

	// 2. 写入体温、今日用药、昨日用药、仅含体重的生长记录及长牙记录
	for _, p := range []map[string]any{
		{"subtype": "temperature", "temperature_c": 37.8, "recorded_at": "2026-11-23T01:00:00Z"},
		{"subtype": "medicine", "medicine_name": "维生素 D3", "medicine_dosage": "1 粒", "recorded_at": "2026-11-23T01:20:00Z"},
		{"subtype": "medicine", "medicine_name": "昨日用药", "recorded_at": "2026-11-22T08:00:00Z"},
		{"subtype": "growth", "weight_kg": 7.1, "recorded_at": "2026-11-20T04:00:00Z"},
		{"subtype": "teeth", "tooth_note": "下中切牙（第 1 颗）", "recorded_at": "2026-11-21T04:00:00Z"},
	} {
		r := env.doJSON(t, http.MethodPost, "/api/records/health", p, true)
		_ = r.Body.Close()
		if r.StatusCode != http.StatusCreated {
			t.Fatalf("create health %v expected 201, got %d", p["subtype"], r.StatusCode)
		}
	}

	// 3. 验证逗号分隔多子类型列表筛选及非法参数拒绝
	clinicalResp := env.doJSON(t, http.MethodGet, "/api/records/health?subtype=temperature,medicine&range=30d&tz=Asia/Shanghai", nil, true)
	if clinicalResp.StatusCode != http.StatusOK {
		t.Fatalf("clinical list expected 200, got %d", clinicalResp.StatusCode)
	}
	var clinicalList records.ListResult[records.HealthRecord, records.HealthDailySummary]
	if err := json.NewDecoder(clinicalResp.Body).Decode(&clinicalList); err != nil {
		t.Fatalf("decode clinical list: %v", err)
	}
	_ = clinicalResp.Body.Close()
	if clinicalList.Total != 3 || clinicalList.DailySummaries["2026-11-23"].TotalCount != 2 ||
		clinicalList.DailySummaries["2026-11-23"].MedicineCount != 1 || clinicalList.DailySummaries["2026-11-23"].GrowthCount != 0 {
		t.Fatalf("unexpected clinical list: total=%d sum=%+v", clinicalList.Total, clinicalList.DailySummaries)
	}

	growthResp := env.doJSON(t, http.MethodGet, "/api/records/health?subtype=growth,teeth&range=all&tz=Asia/Shanghai", nil, true)
	if growthResp.StatusCode != http.StatusOK {
		t.Fatalf("growth list expected 200, got %d", growthResp.StatusCode)
	}
	var growthList records.ListResult[records.HealthRecord, records.HealthDailySummary]
	if err := json.NewDecoder(growthResp.Body).Decode(&growthList); err != nil {
		t.Fatalf("decode growth list: %v", err)
	}
	_ = growthResp.Body.Close()
	if growthList.Total != 2 || len(growthList.Items) != 2 {
		t.Fatalf("expected 2 growth/teeth records, got total=%d len=%d", growthList.Total, len(growthList.Items))
	}

	for _, bad := range []string{"growth,bad", "growth,"} {
		badResp := env.doJSON(t, http.MethodGet, "/api/records/health?subtype="+bad, nil, true)
		if badResp.StatusCode != http.StatusBadRequest {
			_ = badResp.Body.Close()
			t.Errorf("subtype=%q expected 400, got %d", bad, badResp.StatusCode)
			continue
		}
		errBody := decodeJSONMap(t, badResp)
		errMsg, _ := errBody["error"].(string)
		if !strings.Contains(errMsg, "子类型") {
			t.Errorf("subtype=%q expected Chinese error message, got %#v", bad, errBody)
		}
	}

	// 4. 再次读取看板摘要：体重切换为手动测量值，身高保持出生兜底，今日用药与出牙数准确
	afterResp := env.doJSON(t, http.MethodGet, "/api/dashboard/summary?tz=Asia/Shanghai", nil, true)
	if afterResp.StatusCode != http.StatusOK {
		t.Fatalf("after summary expected 200, got %d", afterResp.StatusCode)
	}
	var afterSum dashboard.SummaryResponse
	if err := json.NewDecoder(afterResp.Body).Decode(&afterSum); err != nil {
		t.Fatalf("decode after summary: %v", err)
	}
	_ = afterResp.Body.Close()
	if afterSum.Health.TodayMedicineCount != 1 || afterSum.Health.LatestMedicineName == nil || *afterSum.Health.LatestMedicineName != "维生素 D3" {
		t.Fatalf("unexpected health medicine summary: %+v", afterSum.Health)
	}
	if afterSum.Growth.LatestWeightKg == nil || *afterSum.Growth.LatestWeightKg != 7.1 || afterSum.Growth.WeightIsBirth ||
		afterSum.Growth.LatestHeightCm == nil || *afterSum.Growth.LatestHeightCm != 50.2 || !afterSum.Growth.HeightIsBirth ||
		afterSum.Growth.TeethCount != 1 || afterSum.Growth.LatestToothNote == nil || *afterSum.Growth.LatestToothNote != "下中切牙（第 1 颗）" {
		t.Fatalf("unexpected after growth summary: %+v", afterSum.Growth)
	}
}
