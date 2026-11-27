package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: daily-records / Feeding record CRUD and structured validation / Create direct breastfeeding record; Create bottled breast milk or formula record; Create solid food record; Update and delete feeding record
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Reject unknown record ID on update or delete
 * 测试场景：喂养记录全子类型创建、多方向跨子类型更新清零可空列，以及删除回读与未知 ID 404 防护。
 * 业务背景：家长常在事后修正记录类型（如把配方奶改成亲喂、把辅食改成配方奶或亲喂改成瓶喂），必须通过显式 Select 清空旧子类型专属列为 NULL，防止残留字段污染统计与智能默认值。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无（由步骤 1 经真实 API 创建 4 类喂养形态）
 * 测试目标：
 * 1. 验证亲喂、瓶喂母乳、配方奶、辅食 4 类喂养记录创建成功（201）且返回字段完整。
 * 2. 验证配方奶改亲喂（清 amount_ml）、辅食改配方奶（清 solid_food/solid_amount/acceptance）及亲喂改瓶喂（清 breast_side/duration_min）后，SQLite 废弃可空列均真正落库为 NULL。
 * 3. 验证删除喂养记录后列表 API 与 SQLite 均移除该行，对不存在 ID 的 PUT/DELETE 返回 404。
 */
func TestFeedingCRUDSubtypeClearingAndNotFound(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	feedURL := babyPath(b.ID, "/records/feeding")
	client := app.Client()

	// 1. 创建 4 类完整喂养形态，覆盖亲喂、瓶喂母乳、配方奶与辅食。
	direct := s.AddDirectBreast("left", 15, "2026-11-23T00:00:00Z")
	bottle := s.AddBottleBreast(110, "2026-11-23T00:30:00Z")
	formula := s.AddFormula(120, "2026-11-23T01:00:00Z")
	solid := s.AddSolid("高铁米粉", "半碗", "like", "2026-11-23T01:30:00Z")
	if direct.ID <= 0 || bottle.AmountML == nil || *bottle.AmountML != 110 ||
		formula.ID <= 0 || solid.SolidFood == nil || *solid.SolidFood != "高铁米粉" {
		t.Fatalf("创建的喂养记录字段异常：direct=%+v bottle=%+v formula=%+v solid=%+v", direct, bottle, formula, solid)
	}

	// 2. 验证三组高频跨子类型/跨模式切换，均回读 SQLite 确认旧列显式写为 NULL（防止 GORM 零值跳过残留脏列）。
	client.Put(t, fmt.Sprintf("%s/%d", feedURL, formula.ID), records.FeedingInput{
		Subtype:     records.FeedingSubtypeBreast,
		FeedingMode: ptr("direct"),
		BreastSide:  ptr("right"),
		DurationMin: ptr(18),
		RecordedAt:  "2026-11-23T01:00:00Z",
		Note:        "改为亲喂",
	}).RequireStatus(t, http.StatusOK)
	formulaRow := FirstRow[records.FeedingRecord](t, app, "id = ?", formula.ID)
	if formulaRow.Subtype != records.FeedingSubtypeBreast || formulaRow.AmountML != nil ||
		formulaRow.DurationMin == nil || *formulaRow.DurationMin != 18 || formulaRow.Note != "改为亲喂" {
		t.Fatalf("配方奶改为亲喂后 SQLite 未清空 amount_ml：%+v", formulaRow)
	}

	client.Put(t, fmt.Sprintf("%s/%d", feedURL, solid.ID), records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   ptr(140),
		RecordedAt: "2026-11-23T01:30:00Z",
	}).RequireStatus(t, http.StatusOK)
	solidRow := FirstRow[records.FeedingRecord](t, app, "id = ?", solid.ID)
	if solidRow.Subtype != records.FeedingSubtypeFormula || solidRow.AmountML == nil || *solidRow.AmountML != 140 ||
		solidRow.SolidFood != nil || solidRow.SolidAmount != nil || solidRow.Acceptance != nil {
		t.Fatalf("辅食改为配方奶后 SQLite 未清空辅食列：%+v", solidRow)
	}

	client.Put(t, fmt.Sprintf("%s/%d", feedURL, direct.ID), records.FeedingInput{
		Subtype:     records.FeedingSubtypeBreast,
		FeedingMode: ptr("bottle"),
		AmountML:    ptr(130),
		RecordedAt:  "2026-11-23T00:00:00Z",
	}).RequireStatus(t, http.StatusOK)
	directRow := FirstRow[records.FeedingRecord](t, app, "id = ?", direct.ID)
	if directRow.FeedingMode == nil || *directRow.FeedingMode != "bottle" ||
		directRow.AmountML == nil || *directRow.AmountML != 130 ||
		directRow.BreastSide != nil || directRow.DurationMin != nil {
		t.Fatalf("亲喂改为瓶喂后 SQLite 未清空亲喂侧别与时长：%+v", directRow)
	}

	// 3. 删除记录并经列表与 SQLite 双重回读验证，再核对不存在 ID 返回 404。
	client.Delete(t, fmt.Sprintf("%s/%d", feedURL, formula.ID)).RequireStatus(t, http.StatusOK)
	if got := CountRows[records.FeedingRecord](t, app, "id = ?", formula.ID); got != 0 {
		t.Fatalf("删除喂养记录后 SQLite 仍存在该行：count=%d", got)
	}
	listResp := client.Get(t, feedURL+"?range=all&tz=Asia/Shanghai")
	listResp.RequireStatus(t, http.StatusOK)
	if got := DecodeOK[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](t, listResp).Total; got != 3 {
		t.Fatalf("删除后剩余喂养记录应为 3 条，实际 %d", got)
	}

	client.Put(t, feedURL+"/999999", records.FeedingInput{
		Subtype: records.FeedingSubtypeFormula, AmountML: ptr(90), RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	client.Delete(t, feedURL+"/999999").RequireError(t, http.StatusNotFound, "")
}

/*
 * Spec: daily-records / Sleep record CRUD with backfill validation / Create sleep record from start and end times
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Reject unknown record ID on update or delete
 * 测试场景：睡眠记录补录自动计算时长、更新重算、删除 404，以及跨夜睡眠在列表接口下的交集命中、双日切分小计与子类型分页。
 * 业务背景：宝宝夜间整觉常跨越本地零点，列表页查询“今日”时必须命中跨夜睡眠，并按自然日切分昨日/今日小计以保持与首页看板口径完全一致。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无（步骤 1 验证 CRUD，步骤 2 写入昨日小睡、跨夜整觉与今日小睡）
 * 测试目标：
 * 1. 验证创建 45 分钟小睡服务端自动计算 duration_min=45，更新为 60 分钟同步重算落库，删除后移除且未知 ID 返回 404。
 * 2. 验证 GET /api/babies/:babyId/records/sleep?range=today&tz=Asia/Shanghai 命中跨夜睡眠（22:00→06:00），且 11-22 小计含昨日小睡+120min、11-23 小计含 360min+今日小睡。
 * 3. 验证按 subtype=nap&range=7d&limit=1 分页筛选仅返回小睡，且当日小计不受分页截断。
 */
func TestSleepCRUDDurationRecalcAndCrossMidnightList(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	sleepURL := babyPath(b.ID, "/records/sleep")
	client := app.Client()

	// 1. 睡眠 CRUD 主闭环：创建自动算 45 分钟、更新重算为 60 分钟并回读 SQLite、删除并校验未知 ID 404。
	nap := s.AddSleep(records.SleepSubtypeNap, "2026-11-23T00:15:00Z", "2026-11-23T01:00:00Z")
	if nap.DurationMin != 45 {
		t.Fatalf("预期服务端自动计算 duration_min=45，实际 %d", nap.DurationMin)
	}

	client.Put(t, fmt.Sprintf("%s/%d", sleepURL, nap.ID), records.SleepInput{
		Subtype:   records.SleepSubtypeNap,
		StartedAt: "2026-11-23T00:00:00Z",
		EndedAt:   "2026-11-23T01:00:00Z",
		Note:      "睡得很香",
	}).RequireStatus(t, http.StatusOK)
	persisted := FirstRow[records.SleepRecord](t, app, "id = ?", nap.ID)
	if persisted.DurationMin != 60 || persisted.Note != "睡得很香" {
		t.Fatalf("更新后 SQLite 睡眠时长未同步重算为 60：%+v", persisted)
	}

	client.Delete(t, fmt.Sprintf("%s/%d", sleepURL, nap.ID)).RequireStatus(t, http.StatusOK)
	if got := CountRows[records.SleepRecord](t, app, "id = ?", nap.ID); got != 0 {
		t.Fatalf("删除睡眠记录后 SQLite 仍有残留：count=%d", got)
	}
	client.Put(t, sleepURL+"/999999", records.SleepInput{
		Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T00:00:00Z", EndedAt: "2026-11-23T00:30:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	client.Delete(t, sleepURL+"/999999").RequireError(t, http.StatusNotFound, "")

	// 2. 写入昨日小睡（50min）、跨夜整觉（11-22 22:00+08 → 11-23 06:00+08）与今日两段小睡（40min + 30min），
	//    核对 GET /api/babies/:babyId/records/sleep?range=today 命中跨夜睡眠并按自然日准确切分双日小计。
	s.AddSleep(records.SleepSubtypeNap, "2026-11-22T06:00:00Z", "2026-11-22T06:50:00Z")   // 11-22 14:00~14:50+08
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 11-22 22:00 → 11-23 06:00+08
	s.AddSleep(records.SleepSubtypeNap, "2026-11-23T00:00:00Z", "2026-11-23T00:40:00Z")   // 11-23 08:00~08:40+08
	s.AddSleep(records.SleepSubtypeNap, "2026-11-23T01:00:00Z", "2026-11-23T01:30:00Z")   // 11-23 09:00~09:30+08

	todayResp := client.Get(t, sleepURL+"?range=today&tz=Asia/Shanghai")
	todayResp.RequireStatus(t, http.StatusOK)
	todayList := DecodeOK[records.ListResult[records.SleepRecord, records.SleepDailySummary]](t, todayResp)
	if todayList.Total != 3 || len(todayList.Items) != 3 {
		t.Fatalf("今日睡眠应命中 1 条跨夜整觉与 2 条今日小睡共 3 条，实际 total=%d len=%d", todayList.Total, len(todayList.Items))
	}
	yestSum := todayList.DailySummaries["2026-11-22"]
	if yestSum.TotalMin != 170 || yestSum.NightMin != 120 || yestSum.NapCount != 1 {
		t.Fatalf("昨日睡眠切分小计预期 170min(夜觉120/小睡1次)，实际 %+v", yestSum)
	}
	todaySum := todayList.DailySummaries["2026-11-23"]
	if todaySum.TotalMin != 430 || todaySum.NightMin != 360 || todaySum.NapCount != 2 {
		t.Fatalf("今日睡眠切分小计预期 430min(夜觉360/小睡2次)，实际 %+v", todaySum)
	}

	// 3. 按 subtype=nap&range=7d&limit=1 分页筛选：验证仅返回小睡且 11-23 当日小睡小计保持完整 70min/2次。
	napResp := client.Get(t, sleepURL+"?subtype=nap&range=7d&limit=1&offset=0&tz=Asia/Shanghai")
	napResp.RequireStatus(t, http.StatusOK)
	napList := DecodeOK[records.ListResult[records.SleepRecord, records.SleepDailySummary]](t, napResp)
	if napList.Total != 3 || !napList.HasMore || len(napList.Items) != 1 || napList.Items[0].Subtype != records.SleepSubtypeNap {
		t.Fatalf("小睡分页筛选结果异常：total=%d hasMore=%v items=%+v", napList.Total, napList.HasMore, napList.Items)
	}
	if sum := napList.DailySummaries["2026-11-23"]; sum.TotalMin != 70 || sum.NapCount != 2 || sum.NightMin != 0 {
		t.Fatalf("limit=1 分页后 11-23 小睡小计不应被截断，预期 70min/2次，实际 %+v", sum)
	}
}

/*
 * Spec: daily-records / Care record CRUD and structured validation / Create diaper record with optional stool details; Create bath or other care record
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Reject unknown record ID on update or delete
 * 测试场景：日常护理记录全子类型创建、便便改为纯嘘嘘清空便便详情列、列表筛选分页与每日小计聚合及删除 404。
 * 业务背景：护理页支持按尿布/洗澡/其他筛选并展示当日嘘嘘/便便/洗澡次数小计；当家长把误点的“便便”改为“嘘嘘”时，旧的性状与颜色列必须清空为 NULL。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无（步骤 1 经真实 API 写入尿布、洗澡与自定义护理）
 * 测试目标：
 * 1. 验证便便尿布（含性状/颜色）、嘘嘘+便便双项尿布、洗澡与自定义护理创建成功，便便改嘘嘘后 SQLite 清空 stool_consistency/stool_color 为 NULL。
 * 2. 验证 GET /api/babies/:babyId/records/care?range=today&limit=2 分页不截断今日小计（准确统计嘘嘘/便便/洗澡/其他），且 subtype=diaper 严格隔离非尿布记录。
 * 3. 验证删除护理记录后 SQLite 移除该行，不存在 ID 的 PUT/DELETE 返回 404。
 */
func TestCareCRUDSubtypeClearingAndFilteredList(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	careURL := babyPath(b.ID, "/records/care")
	client := app.Client()

	// 1. 创建全部护理子类型，并将一条便便尿布改为纯嘘嘘，核对 SQLite 便便详情列清为 NULL。
	poop := s.AddDiaper("poop", "soft", "yellow", "2026-11-23T00:30:00Z")
	both := s.AddDiaper("both", "watery", "green", "2026-11-23T00:50:00Z")
	bath := s.AddBath("2026-11-23T01:10:00Z")
	other := s.AddOtherCare("剪指甲", "2026-11-23T01:20:00Z")
	if poop.StoolConsistency == nil || *poop.StoolConsistency != "soft" ||
		both.ID <= 0 || bath.Subtype != records.CareSubtypeBath ||
		other.CareTitle == nil || *other.CareTitle != "剪指甲" {
		t.Fatalf("创建的护理记录字段异常：poop=%+v both=%+v bath=%+v other=%+v", poop, both, bath, other)
	}

	client.Put(t, fmt.Sprintf("%s/%d", careURL, poop.ID), records.CareInput{
		Subtype:    records.CareSubtypeDiaper,
		DiaperKind: ptr("pee"),
		RecordedAt: "2026-11-23T00:30:00Z",
	}).RequireStatus(t, http.StatusOK)
	persisted := FirstRow[records.CareRecord](t, app, "id = ?", poop.ID)
	if persisted.DiaperKind == nil || *persisted.DiaperKind != "pee" ||
		persisted.StoolConsistency != nil || persisted.StoolColor != nil {
		t.Fatalf("便便改为纯嘘嘘后 SQLite 未清空 stool 列：%+v", persisted)
	}

	// 2. 分页查询 GET /api/babies/:babyId/records/care（limit=2）与按 subtype=diaper 筛选，核对每日小计完整不截断且严格隔离。
	pageResp := client.Get(t, careURL+"?range=today&limit=2&offset=0&tz=Asia/Shanghai")
	pageResp.RequireStatus(t, http.StatusOK)
	page := DecodeOK[records.ListResult[records.CareRecord, records.CareDailySummary]](t, pageResp)
	if page.Total != 4 || !page.HasMore || len(page.Items) != 2 {
		t.Fatalf("护理分页结果异常：total=%d hasMore=%v len=%d", page.Total, page.HasMore, len(page.Items))
	}
	sum := page.DailySummaries["2026-11-23"]
	// 今日共 4 条：1 条纯嘘嘘 + 1 条 both（同时计入嘘嘘与便便） + 1 次洗澡 + 1 次其他护理。
	if sum.TotalCount != 4 || sum.PeeCount != 2 || sum.PoopCount != 1 || sum.BathCount != 1 || sum.OtherCount != 1 {
		t.Fatalf("护理今日小计预期 total=4/pee=2/poop=1/bath=1/other=1，实际 %+v", sum)
	}

	diaperResp := client.Get(t, careURL+"?subtype=diaper&range=today&tz=Asia/Shanghai")
	diaperResp.RequireStatus(t, http.StatusOK)
	diaperList := DecodeOK[records.ListResult[records.CareRecord, records.CareDailySummary]](t, diaperResp)
	if diaperList.Total != 2 || diaperList.DailySummaries["2026-11-23"].BathCount != 0 {
		t.Fatalf("仅筛 diaper 时不应混入洗澡记录：total=%d sum=%+v", diaperList.Total, diaperList.DailySummaries)
	}

	// 3. 删除护理记录并校验落库移除，再核对不存在 ID 返回 404。
	client.Delete(t, fmt.Sprintf("%s/%d", careURL, poop.ID)).RequireStatus(t, http.StatusOK)
	if got := CountRows[records.CareRecord](t, app, "id = ?", poop.ID); got != 0 {
		t.Fatalf("删除护理记录后 SQLite 仍有残留：count=%d", got)
	}
	client.Put(t, careURL+"/999999", records.CareInput{
		Subtype: records.CareSubtypeBath, RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	client.Delete(t, careURL+"/999999").RequireError(t, http.StatusNotFound, "")
}

/*
 * Spec: daily-records / Health and growth record CRUD / Create temperature record with fever status classification; Create growth record with partial measurements
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Reject unknown record ID on update or delete
 * 测试场景：健康与生长共享表（health_records）全子类型 CRUD、多方向跨子类型切换清零废弃列及删除 404。
 * 业务背景：体温、用药、体格生长与长牙共享 health_records 表，跨子类型编辑时必须清空旧子类型全部专属列，避免看板生长概览或健康观察误读残余数值。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无（步骤 1 经真实 API 写入 4 类子类型记录）
 * 测试目标：
 * 1. 验证体温（38.6℃）、用药、部分生长测量与长牙 4 类记录创建成功（201）。
 * 2. 验证体温→生长、用药→体温、生长→长牙三组跨子类型更新后，SQLite 废弃专属列均真正写为 NULL。
 * 3. 验证删除记录后 SQLite 彻底移除，对不存在 ID 的 PUT/DELETE 返回 404。
 */
func TestHealthAndGrowthCRUDSubtypeClearing(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	healthURL := babyPath(b.ID, "/records/health")
	client := app.Client()

	// 1. 创建全部 4 类健康与生长记录（生长记录仅填体重以覆盖部分测量场景）。
	temp := s.AddTemperature(38.6, "2026-11-23T01:00:00Z")
	med := s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T01:10:00Z")
	growth := s.AddGrowth(GrowthParams{WeightKg: ptr(6.9), RecordedAt: "2026-11-23T01:20:00Z"})
	tooth := s.AddTooth("下中切牙（第 1 颗）", "2026-11-23T01:30:00Z")
	if temp.TemperatureC == nil || *temp.TemperatureC != 38.6 || med.ID <= 0 ||
		growth.ID <= 0 || growth.WeightKg == nil || *growth.WeightKg != 6.9 ||
		growth.HeightCm != nil || growth.HeadCm != nil || tooth.ID <= 0 {
		t.Fatalf("创建的健康与生长记录异常：temp=%+v med=%+v growth=%+v tooth=%+v", temp, med, growth, tooth)
	}

	// 2. 依次验证体温→完整生长（含三项测量）、用药→体温、生长→长牙三组跨子类型更新，核对 SQLite 旧专属列全部清为 NULL。
	client.Put(t, fmt.Sprintf("%s/%d", healthURL, temp.ID), records.HealthInput{
		Subtype:    records.HealthSubtypeGrowth,
		WeightKg:   ptr(7.2),
		HeightCm:   ptr(63.0),
		HeadCm:     ptr(41.2),
		RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireStatus(t, http.StatusOK)
	tempRow := FirstRow[records.HealthRecord](t, app, "id = ?", temp.ID)
	if tempRow.Subtype != records.HealthSubtypeGrowth || tempRow.TemperatureC != nil ||
		tempRow.WeightKg == nil || *tempRow.WeightKg != 7.2 ||
		tempRow.HeightCm == nil || *tempRow.HeightCm != 63.0 ||
		tempRow.HeadCm == nil || *tempRow.HeadCm != 41.2 {
		t.Fatalf("体温改为生长后 SQLite 未清空 temperature_c 或未落库三项测量：%+v", tempRow)
	}

	client.Put(t, fmt.Sprintf("%s/%d", healthURL, med.ID), records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: ptr(36.8),
		RecordedAt:   "2026-11-23T01:10:00Z",
	}).RequireStatus(t, http.StatusOK)
	medRow := FirstRow[records.HealthRecord](t, app, "id = ?", med.ID)
	if medRow.Subtype != records.HealthSubtypeTemperature || medRow.TemperatureC == nil || *medRow.TemperatureC != 36.8 ||
		medRow.MedicineName != nil || medRow.MedicineDosage != nil {
		t.Fatalf("用药改为体温后 SQLite 未清空药品列：%+v", medRow)
	}

	client.Put(t, fmt.Sprintf("%s/%d", healthURL, temp.ID), records.HealthInput{
		Subtype:    records.HealthSubtypeTeeth,
		ToothNote:  ptr("上中切牙（第 2 颗）"),
		RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireStatus(t, http.StatusOK)
	switchedToTeeth := FirstRow[records.HealthRecord](t, app, "id = ?", temp.ID)
	if switchedToTeeth.Subtype != records.HealthSubtypeTeeth || switchedToTeeth.ToothNote == nil || *switchedToTeeth.ToothNote != "上中切牙（第 2 颗）" ||
		switchedToTeeth.WeightKg != nil || switchedToTeeth.HeightCm != nil || switchedToTeeth.HeadCm != nil {
		t.Fatalf("生长改为长牙后 SQLite 未清空三项体格测量列：%+v", switchedToTeeth)
	}

	// 3. 删除记录后确认 SQLite 移除，并对不存在 ID 校验 404。
	client.Delete(t, fmt.Sprintf("%s/%d", healthURL, growth.ID)).RequireStatus(t, http.StatusOK)
	if got := CountRows[records.HealthRecord](t, app, "id = ?", growth.ID); got != 0 {
		t.Fatalf("删除健康记录后 SQLite 仍有残留：count=%d", got)
	}
	client.Put(t, healthURL+"/999999", records.HealthInput{
		Subtype: records.HealthSubtypeTemperature, TemperatureC: ptr(36.8), RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	client.Delete(t, healthURL+"/999999").RequireError(t, http.StatusNotFound, "")
}

/*
 * Spec: daily-records / Atomic batch creation of feeding and care records / Create feeding and care records atomically in a single batch
 * 测试场景：同一时间点批量补录亲喂、瓶喂母乳、配方奶与合并尿布记录，验证原子落库及列表、每日小计、看板与智能默认值全链路兼容。
 * 业务背景：家长对照月嫂纸质本补录同一时间点的多项喂养与排尿排便记录时，需在一次事务内全部落库，且排尿+排便合并为 both 后各项统计口径不重复也不遗漏。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证 POST /api/babies/:babyId/records/batch 一次提交 3 条喂养与 1 条 both 尿布返回 201，且返回全部自增 ID 与裁剪后的公共备注。
 * 2. 验证回读喂养/护理列表、每日小计、首页看板今日 KPI 与智能默认值准确反映全部 4 条记录。
 * 3. 验证只读查询 SQLite 确认 feeding_records 落库 3 行、care_records 落库 1 行且归属目标宝宝。
 */
func TestRecordsBatchCreateAtomicityAndSummaryIntegration(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	b := app.Scenario().EnsureBaby()
	client := app.Client()

	// 1. 同一时间点提交亲喂(左 15 分)、瓶喂母乳(40ml)、配方奶(60ml)与合并尿布(both + 软便/黄色)及公共备注。
	ts := "2026-11-23T01:10:00Z" // 上海 09:10
	batchResp := client.Post(t, babyPath(b.ID, "/records/batch"), records.BatchCreateInput{
		Feedings: []records.FeedingInput{
			{
				Subtype:     records.FeedingSubtypeBreast,
				FeedingMode: ptr("direct"),
				BreastSide:  ptr("left"),
				DurationMin: ptr(15),
				RecordedAt:  ts,
				Note:        "  月嫂纸质本补录  ",
			},
			{
				Subtype:     records.FeedingSubtypeBreast,
				FeedingMode: ptr("bottle"),
				AmountML:    ptr(40),
				RecordedAt:  ts,
				Note:        "  月嫂纸质本补录  ",
			},
			{
				Subtype:    records.FeedingSubtypeFormula,
				AmountML:   ptr(60),
				RecordedAt: ts,
				Note:       "  月嫂纸质本补录  ",
			},
		},
		Cares: []records.CareInput{
			{
				Subtype:          records.CareSubtypeDiaper,
				DiaperKind:       ptr("both"),
				StoolConsistency: ptr("soft"),
				StoolColor:       ptr("yellow"),
				RecordedAt:       ts,
				Note:             "  月嫂纸质本补录  ",
			},
		},
	})
	created := DecodeStatus[records.BatchCreateResult](t, batchResp, http.StatusCreated)
	if len(created.Feedings) != 3 || len(created.Cares) != 1 {
		t.Fatalf("批量创建预期返回 3 条喂养与 1 条护理，实际 feedings=%d cares=%d", len(created.Feedings), len(created.Cares))
	}
	if created.Feedings[0].ID <= 0 || created.Feedings[2].ID <= 0 || created.Cares[0].ID <= 0 {
		t.Fatalf("批量创建返回记录缺少自增 ID：%+v", created)
	}
	if created.Feedings[0].Note != "月嫂纸质本补录" || created.Cares[0].Note != "月嫂纸质本补录" {
		t.Fatalf("批量创建未裁剪公共备注：feeding=%q care=%q", created.Feedings[0].Note, created.Cares[0].Note)
	}

	// 2. 回读喂养/护理列表、每日小计、首页今日看板及智能默认值，核对同时间戳多条记录的统计口径与换侧建议。
	feedList := DecodeOK[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](
		t,
		client.Get(t, babyPath(b.ID, "/records/feeding?range=today&tz="+defaultTimezone)),
	)
	feedSum := feedList.DailySummaries["2026-11-23"]
	if feedList.Total != 3 || feedSum.TotalML != 100 || feedSum.DirectBreastCount != 1 || feedSum.DirectBreastMin != 15 || feedSum.TotalCount != 3 {
		t.Fatalf("喂养列表或每日小计异常：total=%d sum=%+v", feedList.Total, feedSum)
	}

	careList := DecodeOK[records.ListResult[records.CareRecord, records.CareDailySummary]](
		t,
		client.Get(t, babyPath(b.ID, "/records/care?range=today&tz="+defaultTimezone)),
	)
	careSum := careList.DailySummaries["2026-11-23"]
	if careList.Total != 1 || careSum.PeeCount != 1 || careSum.PoopCount != 1 || careSum.TotalCount != 1 {
		t.Fatalf("护理列表或合并尿布每日小计异常：total=%d sum=%+v", careList.Total, careSum)
	}

	dash := DecodeOK[dashboard.SummaryResponse](t, client.Get(t, babyPath(b.ID, "/dashboard/summary?tz="+defaultTimezone)))
	if dash.Feeding.TotalML != 100 || dash.Feeding.DirectBreastCount != 1 || dash.Care.PeeCount != 1 || dash.Care.PoopCount != 1 || dash.Care.TotalCount != 1 {
		t.Fatalf("首页今日看板汇总与批量补录不一致：feeding=%+v care=%+v", dash.Feeding, dash.Care)
	}
	if dash.Feeding.LastFeedingAt == nil || *dash.Feeding.LastFeedingAt != ts || dash.Care.LastDiaperAt == nil || *dash.Care.LastDiaperAt != ts {
		t.Fatalf("首页距上次照护时间戳未更新：feeding=%v care=%v", dash.Feeding.LastFeedingAt, dash.Care.LastDiaperAt)
	}

	defaults := DecodeOK[records.SmartDefaults](t, client.Get(t, babyPath(b.ID, "/records/defaults")))
	if defaults.Feeding.SuggestedBreastSide != "right" || defaults.Feeding.LastMilkML != 60 {
		t.Fatalf("批量补录后智能默认值未反映最新亲喂换侧与奶量：%+v", defaults.Feeding)
	}

	// 3. 只读查询 SQLite 核验落库终态行数与宝宝归属。
	if got := CountRows[records.FeedingRecord](t, app, "baby_id = ?", b.ID); got != 3 {
		t.Fatalf("SQLite feeding_records 预期 3 行，实际 %d", got)
	}
	if got := CountRows[records.CareRecord](t, app, "baby_id = ?", b.ID); got != 1 {
		t.Fatalf("SQLite care_records 预期 1 行，实际 %d", got)
	}
}

/*
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Filter feeding records by subtype and date range; Filter health records by comma-separated subtype group; Reject invalid or empty token in comma-separated health subtype filter
 * 测试场景：喂养记录时区筛选与稀疏跨月分页完整小计，以及健康记录逗号多子类型严格隔离与非法 token 拒绝。
 * 业务背景：喂养页与独立的健康(/health)/生长(/growth)工作区均依赖后端按筛选条件准确计算每日小计，分页不得截断同日小计，非法逗号 token 须明确报错。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：6 条跨 UTC 日界线与跨月喂养记录（5 条配方奶 + 1 条亲喂）；5 条覆盖体温/用药/生长/长牙的健康记录
 * 测试目标：
 * 1. 验证 formula + range=7d + limit=1 仅返回 1 条，但 2026-11-23 小计完整汇总跨 UTC 凌晨在内的 2 条共 270ml；range=all + limit=4 跨月命中 05-01 完整小计 150ml。
 * 2. 验证 health 逗号筛选 temperature,medicine 与 growth,teeth 严格隔离记录及每日小计。
 * 3. 验证非法或含空白项的健康逗号子类型参数返回 400 中文错误。
 */
func TestFeedingAndHealthFilteredPaginationSummaries(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	feedURL := babyPath(b.ID, "/records/feeding")
	healthURL := babyPath(b.ID, "/records/health")
	client := app.Client()

	// 前置造数：写入跨 UTC 日界线（11-22T17:00Z == 11-23 01:00+08）与跨月（05-01）喂养记录及全健康子类型记录。
	s.AddFormula(120, "2026-11-23T01:00:00Z") // 11-23 09:00+08
	s.AddFormula(150, "2026-11-22T17:00:00Z") // 11-23 01:00+08
	s.AddFormula(120, "2026-11-22T10:00:00Z") // 11-22 18:00+08
	s.AddFormula(80, "2026-05-01T00:00:00Z")  // 05-01 08:00+08（7d 窗口外）
	s.AddFormula(70, "2026-05-01T06:00:00Z")  // 05-01 14:00+08（7d 窗口外）
	s.AddDirectBreast("left", 18, "2026-11-23T00:00:00Z")

	s.AddTemperature(37.8, "2026-11-23T01:00:00Z")
	s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T01:20:00Z")
	s.AddMedicine("昨日用药", "", "2026-11-22T08:00:00Z")
	s.AddGrowth(GrowthParams{WeightKg: ptr(7.1), RecordedAt: "2026-11-20T04:00:00Z"})
	s.AddTooth("下中切牙（第 1 颗）", "2026-11-21T04:00:00Z")

	// 1. 验证喂养 7d 分页与稀疏跨月 range=all 均不截断当日完整小计。
	page1Resp := client.Get(t, feedURL+"?subtype=formula&range=7d&tz=Asia/Shanghai&limit=1&offset=0")
	page1Resp.RequireStatus(t, http.StatusOK)
	page1 := DecodeOK[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](t, page1Resp)
	if page1.Total != 3 || !page1.HasMore || len(page1.Items) != 1 {
		t.Fatalf("7d 配方奶分页元数据异常：total=%d hasMore=%v len=%d", page1.Total, page1.HasMore, len(page1.Items))
	}
	if sum := page1.DailySummaries["2026-11-23"]; sum.TotalML != 270 || sum.TotalCount != 2 {
		t.Fatalf("limit=1 不应截断 2026-11-23 小计，预期 270ml/2次，实际 %+v", sum)
	}

	sparseResp := client.Get(t, feedURL+"?subtype=formula&range=all&tz=Asia/Shanghai&limit=4&offset=0")
	sparseResp.RequireStatus(t, http.StatusOK)
	sparse := DecodeOK[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](t, sparseResp)
	if sparse.Total != 5 || !sparse.HasMore || len(sparse.Items) != 4 || sparse.DailySummaries["2026-05-01"].TotalML != 150 {
		t.Fatalf("稀疏跨月分页 2026-05-01 小计应完整为 150ml，实际 total=%d len=%d sum=%+v", sparse.Total, len(sparse.Items), sparse.DailySummaries)
	}
	for i := 1; i < len(sparse.Items); i++ {
		if sparse.Items[i-1].RecordedAt < sparse.Items[i].RecordedAt {
			t.Fatalf("喂养列表未按 recorded_at DESC 倒序排列：[%d]=%s < [%d]=%s",
				i-1, sparse.Items[i-1].RecordedAt, i, sparse.Items[i].RecordedAt)
		}
	}

	// 2. 验证健康与生长两个工作区对应的逗号多子类型筛选严格隔离记录及每日小计。
	clinResp := client.Get(t, healthURL+"?subtype=temperature,medicine&range=30d&tz=Asia/Shanghai")
	clinResp.RequireStatus(t, http.StatusOK)
	clin := DecodeOK[records.ListResult[records.HealthRecord, records.HealthDailySummary]](t, clinResp)
	sumToday := clin.DailySummaries["2026-11-23"]
	if clin.Total != 3 || sumToday.TotalCount != 2 || sumToday.MedicineCount != 1 ||
		sumToday.LatestTempC == nil || *sumToday.LatestTempC != 37.8 {
		t.Fatalf("临床健康筛选结果异常：total=%d sum=%+v", clin.Total, clin.DailySummaries)
	}
	if _, leaked := clin.DailySummaries["2026-11-20"]; leaked {
		t.Fatalf("临床健康筛选不应混入生长记录所在日期 2026-11-20：%+v", clin.DailySummaries)
	}

	growthResp := client.Get(t, healthURL+"?subtype=growth,teeth&range=all&tz=Asia/Shanghai")
	growthResp.RequireStatus(t, http.StatusOK)
	growth := DecodeOK[records.ListResult[records.HealthRecord, records.HealthDailySummary]](t, growthResp)
	if growth.Total != 2 || len(growth.Items) != 2 {
		t.Fatalf("生长与长牙筛选预期 2 条，实际 total=%d len=%d", growth.Total, len(growth.Items))
	}
	if _, leaked := growth.DailySummaries["2026-11-23"]; leaked {
		t.Fatalf("生长与长牙筛选的每日小计不应混入体温/用药日期 2026-11-23：%+v", growth.DailySummaries)
	}
	if gSum := growth.DailySummaries["2026-11-20"]; gSum.TotalCount != 1 || gSum.MedicineCount != 0 || gSum.LatestTempC != nil {
		t.Fatalf("生长与长牙筛选 2026-11-20 小计隔离异常：%+v", gSum)
	}

	// 3. 验证含未知子类型或空项的逗号参数返回 400 中文错误。
	for _, bad := range []string{"temperature,unknown", "growth,", ",teeth", "all,growth"} {
		client.Get(t, healthURL+"?subtype="+bad).RequireError(t, http.StatusBadRequest, "子类型")
	}
}

/*
 * Spec: daily-records / Smart defaults endpoint for low-friction entry / Return sensible starter defaults when history is empty; Compute smart defaults from recent history
 * 测试场景：验证空历史冷启动智能默认值，以及多品类丰富历史下的奶量 Top-3 破平局、亲喂换侧、辅食/用药去重保最新份量剂量、睡眠中位数与护理去重限 5 条。
 * 业务背景：快捷录入抽屉与首页一键直记高度依赖 /api/babies/:babyId/records/defaults 降低输入摩擦，既要在新宝宝冷启动时给出开箱预设，也要在长期记录演进中按频次与最近优先精确排序去重。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：步骤 1 为空历史；步骤 2 写入 4 档奶量（检验 Top-3 与同频次最近优先）、亲喂+瓶喂母乳、重复带份量辅食、多条睡眠、重复带剂量用药与 6 种自定义护理
 * 测试目标：
 * 1. 验证空历史下返回合理冷启动初始默认值（90ml、[60,90,120]、formula、direct/15min、nap=60/night=480、体温 36.6）。
 * 2. 验证写入完整习惯历史后，奶量 Top-3 淘汰较早同频次档并升序返回 [120,150,180]、亲喂换侧 right→left、辅食与药品去重保留最新份量/剂量、睡眠取中位数且自定义护理去重限制 5 条。
 */
func TestRecordsSmartDefaultsStarterAndEvolution(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	defaultsURL := babyPath(b.ID, "/records/defaults")
	client := app.Client()

	// 1. 空历史冷启动探测：确保全部预设字段有合理默认值且集合为空数组而非报错。
	emptyResp := client.Get(t, defaultsURL)
	emptyResp.RequireStatus(t, http.StatusOK)
	starter := DecodeOK[records.SmartDefaults](t, emptyResp)
	if starter.Feeding.LastMilkML != records.DefaultStarterMilk ||
		starter.Feeding.LastFeedingSubtype != records.FeedingSubtypeFormula ||
		starter.Feeding.LastMilkSubtype != records.FeedingSubtypeFormula ||
		starter.Feeding.LastBreastMode != "direct" ||
		starter.Feeding.LastBreastDurationMin != records.DefaultStarterBreastMin ||
		starter.Feeding.SuggestedBreastSide != "left" ||
		len(starter.Feeding.RecentSolids) != 0 ||
		starter.Sleep.SuggestedNapMin != records.DefaultStarterNapMin ||
		starter.Sleep.SuggestedNightMin != records.DefaultStarterNightMin ||
		starter.Health.LastTemperatureC != records.DefaultStarterTemp ||
		len(starter.Feeding.FrequentMilkML) != 3 ||
		starter.Feeding.FrequentMilkML[0] != 60 ||
		starter.Feeding.FrequentMilkML[1] != 90 ||
		starter.Feeding.FrequentMilkML[2] != 120 {
		t.Fatalf("空历史冷启动智能默认值异常：%+v", starter)
	}

	// 2. 写入完整习惯历史并校验全部推导与去重边界。
	//    4 档奶量均出现 2 次（100 最早、120 次早、150 次新、180 最新）：同频次按最近优先应淘汰 100，升序返回 [120, 150, 180]。
	s.AddFormula(100, "2026-11-22T01:00:00Z")
	s.AddFormula(100, "2026-11-22T02:00:00Z")
	s.AddFormula(120, "2026-11-22T03:00:00Z")
	s.AddFormula(120, "2026-11-22T04:00:00Z")
	s.AddFormula(150, "2026-11-22T06:00:00Z")
	s.AddFormula(150, "2026-11-22T08:00:00Z")
	s.AddFormula(180, "2026-11-22T10:00:00Z")
	s.AddDirectBreast("right", 12, "2026-11-22T11:30:00Z")
	s.AddBottleBreast(180, "2026-11-22T12:00:00Z")
	s.AddSolid("米糊", "几口", "like", "2026-11-22T12:10:00Z")
	s.AddSolid("南瓜泥", "半碗", "", "2026-11-22T12:20:00Z")
	s.AddSolid("苹果泥", "", "", "2026-11-22T12:30:00Z")
	s.AddSolid("胡萝卜泥", "", "", "2026-11-22T12:40:00Z")
	s.AddSolid("牛油果泥", "", "", "2026-11-22T12:50:00Z")
	s.AddSolid("香蕉泥", "几口", "", "2026-11-22T13:00:00Z")
	s.AddSolid("香蕉泥", "半根", "like", "2026-11-22T13:10:00Z")

	// 小睡 40/45/50/120/45 分钟 → 中位数 45；夜觉 540/600/570 分钟 → 中位数 570。
	s.AddSleep(records.SleepSubtypeNap, "2026-11-21T01:00:00Z", "2026-11-21T01:40:00Z")
	s.AddSleep(records.SleepSubtypeNap, "2026-11-21T05:00:00Z", "2026-11-21T05:45:00Z")
	s.AddSleep(records.SleepSubtypeNap, "2026-11-22T01:00:00Z", "2026-11-22T01:50:00Z")
	s.AddSleep(records.SleepSubtypeNap, "2026-11-22T05:00:00Z", "2026-11-22T07:00:00Z")
	s.AddSleep(records.SleepSubtypeNap, "2026-11-23T00:15:00Z", "2026-11-23T01:00:00Z")
	s.AddSleep(records.SleepSubtypeNight, "2026-11-20T13:00:00Z", "2026-11-20T22:00:00Z")
	s.AddSleep(records.SleepSubtypeNight, "2026-11-21T13:00:00Z", "2026-11-21T23:00:00Z")
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T13:00:00Z", "2026-11-22T22:30:00Z")

	// 同药品「维生素 D3」先后记录不同剂量，去重后应锁定最新剂量「2 粒」。
	s.AddTemperature(37.4, "2026-11-23T01:05:00Z")
	s.AddMedicine("维生素 D3", "1 粒", "2026-11-22T01:15:00Z")
	s.AddMedicine("布洛芬", "2.5 ml", "2026-11-23T01:10:00Z")
	s.AddMedicine("维生素 D3", "2 粒", "2026-11-23T01:15:00Z")

	// 写入 6 种自定义护理标题（含重复项），核对去重后最多保留最近 5 项。
	s.AddOtherCare("抚触按摩", "2026-11-23T00:05:00Z")
	s.AddOtherCare("洗鼻子", "2026-11-23T00:15:00Z")
	s.AddOtherCare("涂护臀膏", "2026-11-23T00:25:00Z")
	s.AddOtherCare("晒太阳", "2026-11-23T00:35:00Z")
	s.AddOtherCare("擦口水疹", "2026-11-23T00:45:00Z")
	s.AddOtherCare("剪指甲", "2026-11-23T00:55:00Z")
	s.AddOtherCare("洗鼻子", "2026-11-23T01:20:00Z")

	popResp := client.Get(t, defaultsURL)
	popResp.RequireStatus(t, http.StatusOK)
	got := DecodeOK[records.SmartDefaults](t, popResp)

	if got.Feeding.LastMilkML != 180 || got.Feeding.LastFeedingSubtype != records.FeedingSubtypeSolid ||
		got.Feeding.LastMilkSubtype != records.FeedingSubtypeBreast {
		t.Errorf("奶量与最近子类型推导异常：%+v", got.Feeding)
	}
	if got.Feeding.LastBreastMode != "bottle" || got.Feeding.LastBreastDurationMin != 12 {
		t.Errorf("母乳模式或亲喂时长推导异常：%+v", got.Feeding)
	}
	if got.Feeding.LastBreastSide == nil || *got.Feeding.LastBreastSide != "right" || got.Feeding.SuggestedBreastSide != "left" {
		t.Errorf("预期上次右侧亲喂推荐左侧，实际 %+v", got.Feeding)
	}
	wantFreq := []int{120, 150, 180}
	if len(got.Feeding.FrequentMilkML) != 3 ||
		got.Feeding.FrequentMilkML[0] != wantFreq[0] ||
		got.Feeding.FrequentMilkML[1] != wantFreq[1] ||
		got.Feeding.FrequentMilkML[2] != wantFreq[2] {
		t.Errorf("同频次破平局后 Top-3 奶量预期 %v，实际 %v", wantFreq, got.Feeding.FrequentMilkML)
	}
	if len(got.Feeding.RecentSolids) != 5 || got.Feeding.RecentSolids[0].Food != "香蕉泥" || got.Feeding.RecentSolids[0].Amount != "半根" {
		t.Errorf("去重辅食预期 5 项且首项为香蕉泥(半根)，实际 %+v", got.Feeding.RecentSolids)
	}
	if got.Sleep.SuggestedNapMin != 45 || got.Sleep.SuggestedNightMin != 570 {
		t.Errorf("中位数睡眠时长预期 nap=45/night=570，实际 %+v", got.Sleep)
	}
	if got.Health.LastTemperatureC != 37.4 || len(got.Health.RecentMedicines) != 2 ||
		got.Health.RecentMedicines[0].Name != "维生素 D3" || got.Health.RecentMedicines[0].Dosage != "2 粒" ||
		got.Health.RecentMedicines[1].Name != "布洛芬" {
		t.Errorf("健康默认值与药品去重最新剂量异常：%+v", got.Health)
	}
	if len(got.Care.RecentOtherTitles) != 5 || got.Care.RecentOtherTitles[0] != "洗鼻子" || got.Care.RecentOtherTitles[1] != "剪指甲" {
		t.Errorf("自定义护理标题去重应保留最近 5 项且首项为洗鼻子，实际 %+v", got.Care)
	}
}

/*
 * Spec: daily-records / Authenticated access and baby-profile precondition for records / Reject unauthenticated record request; Reject record write before baby onboarding; Reject record access for foreign baby ID
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Reject unknown record ID on update or delete
 * 测试场景：验证日常记录接口的未认证门禁（401）、未建档与跨用户/跨宝宝越权拦截（404），以及非法分页/范围/子类型/时区与路径参数校验（400）。
 * 业务背景：所有日常记录严格隶属已鉴权的宝宝路径，必须同时拦死未登录访问、访问不存在或他人宝宝 ID、挂兄弟宝宝路径篡改记录 ID，以及非法查询参数。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：用户 A（admin）与普通用户 B（已完成改密）及匿名客户端
 * - 宝宝档案：步骤 1–2 用户 A 未建档；步骤 3 用户 A 建大宝/二宝、用户 B 建三宝
 * - 前置业务记录：步骤 3 分别在大宝与三宝名下写入喂养记录
 * 测试目标：
 * 1. 验证未认证请求四类记录接口与智能默认值接口全部返回 401 中文错误。
 * 2. 验证用户未建档时读写 /api/babies/999/records/* 返回 404 且 SQLite 无脏数据。
 * 3. 验证建档后非法列表参数与非法路径 :id 返回 400，且跨用户 babyId 与同用户跨宝宝 record_id 改删均返回 404 不泄露也不篡改原数据。
 */
func TestRecordsAuthOnboardingAndQueryParamGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	clientA := app.Client()
	clientB, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	// 1. 未认证访问各记录端点全部返回 401。
	for _, suffix := range []string{
		"/records/feeding",
		"/records/sleep",
		"/records/care",
		"/records/health",
		"/records/defaults",
	} {
		anon.Get(t, babyPath(1, suffix)).RequireError(t, http.StatusUnauthorized, "")
	}

	// 2. 已认证但无对应宝宝时读写接口统一返回 404 且写请求不落库。
	clientA.Get(t, babyPath(999, "/records/defaults")).RequireError(t, http.StatusNotFound, "")
	clientA.Get(t, babyPath(999, "/records/sleep")).RequireError(t, http.StatusNotFound, "")
	clientA.Post(t, babyPath(999, "/records/feeding"), records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   ptr(120),
		RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
		t.Fatalf("未建档拒绝写入后不应产生喂养记录，实际 %d", got)
	}

	// 3. 建档后核对非法查询参数返回 400，以及跨用户 babyId 与同用户跨宝宝 record_id 均返回 404 零串扰。
	sA := app.ScenarioFor(clientA)
	babyA1 := sA.EnsureBaby(BabyParams{Nickname: "大宝"})
	feedA1 := sA.AddFormula(120, "2026-11-23T01:00:00Z")
	babyA2 := sA.EnsureBaby(BabyParams{Nickname: "二宝"})
	babyB := app.ScenarioFor(clientB).EnsureBaby(BabyParams{Nickname: "B宝"})
	feedB := app.ScenarioFor(clientB).ForBaby(babyB.ID).AddFormula(150, "2026-11-23T01:10:00Z")

	for _, badQuery := range []string{
		"/records/feeding?limit=0",
		"/records/feeding?limit=101",
		"/records/feeding?offset=-1",
		"/records/feeding?range=999d",
		"/records/feeding?tz=Invalid/Zone",
		"/records/feeding?subtype=unknown",
		"/records/sleep?subtype=invalid",
		"/records/care?subtype=invalid",
	} {
		clientA.Get(t, babyPath(babyA1.ID, badQuery)).RequireError(t, http.StatusBadRequest, "")
	}
	clientA.Delete(t, babyPath(babyA1.ID, "/records/feeding/abc")).RequireError(t, http.StatusBadRequest, "编号")
	clientA.Delete(t, babyPath(babyA1.ID, "/records/sleep/0")).RequireError(t, http.StatusBadRequest, "编号")

	// 跨用户访问他人 babyId 返回 404；二宝冷启动默认值不受大宝与 B 宝污染。
	clientB.Get(t, babyPath(babyA1.ID, "/records/feeding")).RequireError(t, http.StatusNotFound, "")
	clientB.Post(t, babyPath(babyA1.ID, "/records/feeding"), records.FeedingInput{
		Subtype: records.FeedingSubtypeFormula, AmountML: ptr(90), RecordedAt: "2026-11-23T01:20:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	if defA2 := DecodeOK[records.SmartDefaults](t, clientA.Get(t, babyPath(babyA2.ID, "/records/defaults"))); defA2.Feeding.LastMilkML != records.DefaultStarterMilk {
		t.Fatalf("二宝尚无记录，智能默认值不应受大宝或他人污染：%+v", defA2.Feeding)
	}

	// 同用户挂二宝路径改删大宝记录、以及挂自身路径改删他人记录均返回 404 且原记录不变。
	clientA.Put(t, babyPath(babyA2.ID, fmt.Sprintf("/records/feeding/%d", feedA1.ID)), records.FeedingInput{
		Subtype: records.FeedingSubtypeFormula, AmountML: ptr(99), RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusNotFound, "")
	clientA.Delete(t, babyPath(babyA2.ID, fmt.Sprintf("/records/feeding/%d", feedA1.ID))).RequireError(t, http.StatusNotFound, "")
	clientA.Delete(t, babyPath(babyA1.ID, fmt.Sprintf("/records/feeding/%d", feedB.ID))).RequireError(t, http.StatusNotFound, "")
	if row := FirstRow[records.FeedingRecord](t, app, "id = ?", feedA1.ID); row.AmountML == nil || *row.AmountML != 120 {
		t.Fatalf("跨宝宝越权被拒后大宝记录不应被篡改：%+v", row)
	}
	if row := FirstRow[records.FeedingRecord](t, app, "id = ?", feedB.ID); row.AmountML == nil || *row.AmountML != 150 {
		t.Fatalf("跨用户越权被拒后 B 宝记录不应被篡改：%+v", row)
	}
}

/*
 * Spec: daily-records / Authenticated access and baby-profile precondition for records / Reject future record timestamp beyond clock skew
 * Spec: daily-records / Feeding record CRUD and structured validation / Reject invalid feeding payload
 * Spec: daily-records / Sleep record CRUD with backfill validation / Reject invalid sleep time interval
 * Spec: daily-records / Care record CRUD and structured validation / Reject invalid care payload
 * Spec: daily-records / Health and growth record CRUD / Reject empty growth or medicine record
 * 测试场景：集中验证超前服务端 5 分钟的未来时间与四大品类非法写入载荷全部被拒绝且零脏写。
 * 业务背景：防止手机时钟漂移误录未来记录或表单缺填必填维度，所有校验失败请求必须返回 400 中文提示并保证 SQLite 四张记录表保持纯净。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（UTC 02:00，超前 6 分钟即 02:06Z 越界）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证喂养超前未来时间、配方奶缺量/<=0、辅食空名返回 400 且喂养表零行。
 * 2. 验证睡眠结束早于/等于开始、超 24 小时及结束时间超前 5 分钟返回 400 且睡眠表零行。
 * 3. 验证护理缺 diaper_kind 或自定义空标题、健康空生长/空药名/空长牙/越界体温返回 400 且两表均零行。
 */
func TestRecordsFutureClockSkewAndInvalidPayloads(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	b := app.Scenario().EnsureBaby()
	client := app.Client()

	// defaultFixedNow 为 2026-11-23T02:00:00Z，+6 分钟即超过 5 分钟未来时钟偏移上限。
	futureTS := "2026-11-23T02:06:00Z"
	validTS := "2026-11-23T01:00:00Z"

	// 1. 喂养非法载荷（未来时间、缺奶量、零奶量、空白辅食名）全部返回 400 且零落库。
	for _, in := range []records.FeedingInput{
		{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(120), RecordedAt: futureTS},
		{Subtype: records.FeedingSubtypeFormula, RecordedAt: validTS},
		{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(0), RecordedAt: validTS},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: ptr("   "), RecordedAt: validTS},
	} {
		client.Post(t, babyPath(b.ID, "/records/feeding"), in).RequireError(t, http.StatusBadRequest, "")
	}
	if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
		t.Fatalf("非法喂养请求后 SQLite 应为 0 行，实际 %d", got)
	}

	// 2. 睡眠非法载荷（零时长、倒挂、超 24 小时、结束时间超前未来）全部返回 400 且零落库。
	for _, in := range []records.SleepInput{
		{Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T01:00:00Z", EndedAt: "2026-11-23T01:00:00Z"},
		{Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T01:30:00Z", EndedAt: "2026-11-23T01:00:00Z"},
		{Subtype: records.SleepSubtypeNight, StartedAt: "2026-11-21T00:00:00Z", EndedAt: "2026-11-22T01:00:00Z"},
		{Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T01:30:00Z", EndedAt: futureTS},
	} {
		client.Post(t, babyPath(b.ID, "/records/sleep"), in).RequireError(t, http.StatusBadRequest, "")
	}
	if got := CountRows[records.SleepRecord](t, app, ""); got != 0 {
		t.Fatalf("非法睡眠请求后 SQLite 应为 0 行，实际 %d", got)
	}

	// 3. 护理与健康非法载荷全部返回 400 且对应表零落库。
	for _, in := range []records.CareInput{
		{Subtype: records.CareSubtypeDiaper, RecordedAt: validTS},
		{Subtype: records.CareSubtypeOther, CareTitle: ptr("   "), RecordedAt: validTS},
	} {
		client.Post(t, babyPath(b.ID, "/records/care"), in).RequireError(t, http.StatusBadRequest, "")
	}
	if got := CountRows[records.CareRecord](t, app, ""); got != 0 {
		t.Fatalf("非法护理请求后 SQLite 应为 0 行，实际 %d", got)
	}

	for _, in := range []records.HealthInput{
		{Subtype: records.HealthSubtypeGrowth, RecordedAt: validTS},
		{Subtype: records.HealthSubtypeMedicine, MedicineName: ptr("   "), RecordedAt: validTS},
		{Subtype: records.HealthSubtypeTeeth, ToothNote: ptr(""), RecordedAt: validTS},
		{Subtype: records.HealthSubtypeTemperature, TemperatureC: ptr(33.0), RecordedAt: validTS},
	} {
		client.Post(t, babyPath(b.ID, "/records/health"), in).RequireError(t, http.StatusBadRequest, "")
	}
	if got := CountRows[records.HealthRecord](t, app, ""); got != 0 {
		t.Fatalf("非法健康请求后 SQLite 应为 0 行，实际 %d", got)
	}
}

/*
 * Spec: daily-records / Atomic batch creation of feeding and care records / Reject empty or oversized batch record payload; Roll back entire batch when any item fails validation; Reject batch record write for unauthenticated or foreign baby scope
 * 测试场景：验证批量补录接口的鉴权/强制改密/跨宝宝隔离防线，以及空批次、超上限、未知字段与混合非法项时的全事务回滚零脏写。
 * 业务背景：单次补录可能同时写入喂养与护理两张表，若任一项校验失败或权限不足，必须拒绝整批写入并保持数据库零残留，防止家长重试时产生重复记录。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已登录管理员、待改密普通用户 UserPending 与已就绪普通用户 UserB
 * - 宝宝档案：管理员名下小汤圆
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证未认证返回 401、待强制改密用户返回 403、他人或不存在 babyId 返回 404，且两张表零脏写。
 * 2. 验证空批次（0 条）、超上限批次（21 条）与未知 JSON 字段返回 400 且零脏写。
 * 3. 验证合法喂养混入非法护理、合法护理混入超前 5 分钟未来喂养均返回 400 且整批回滚（feeding_records 与 care_records 均为 0 行）。
 */
func TestRecordsBatchCreateValidationRollbackAndAuthGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	adminClient := app.Client()
	pendingClient, _ := app.CreateUserViaAdmin("UserPending", "pending-init-secret-123")
	userBClient, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	// 前置造数：管理员创建目标宝宝档案。
	b := app.Scenario().EnsureBaby()
	batchURL := babyPath(b.ID, "/records/batch")
	validTS := "2026-11-23T01:00:00Z"
	futureTS := "2026-11-23T02:06:00Z"

	validPayload := records.BatchCreateInput{
		Feedings: []records.FeedingInput{{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(90), RecordedAt: validTS}},
	}

	// 1. 鉴权、强制改密门禁与跨用户/未知宝宝隔离防护：依次断言 401 / 403 / 404 且零落库。
	anon.Post(t, batchURL, validPayload).RequireError(t, http.StatusUnauthorized, "")
	pendingClient.Post(t, batchURL, validPayload).RequireError(t, http.StatusForbidden, "初始密码")
	userBClient.Post(t, batchURL, validPayload).RequireError(t, http.StatusNotFound, "")
	adminClient.Post(t, babyPath(999999, "/records/batch"), validPayload).RequireError(t, http.StatusNotFound, "")

	// 2. 空批次、超出 20 条上限批次及含未知字段载荷全部返回 400。
	adminClient.Post(t, batchURL, records.BatchCreateInput{}).RequireError(t, http.StatusBadRequest, "至少填写一项")

	oversized := make([]records.FeedingInput, records.MaxBatchCreateItems+1)
	for i := range oversized {
		oversized[i] = records.FeedingInput{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(60), RecordedAt: validTS}
	}
	adminClient.Post(t, batchURL, records.BatchCreateInput{Feedings: oversized}).RequireError(t, http.StatusBadRequest, "最多批量提交")
	adminClient.Post(t, batchURL, map[string]any{
		"feedings": []records.FeedingInput{{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(60), RecordedAt: validTS}},
		"unknown":  true,
	}).RequireError(t, http.StatusBadRequest, "")

	// 3. 混合合法与非法条目（非法护理项、超前 5 分钟未来时间戳）返回 400 且整事务回滚零脏写。
	adminClient.Post(t, batchURL, records.BatchCreateInput{
		Feedings: []records.FeedingInput{{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(90), RecordedAt: validTS}},
		Cares:    []records.CareInput{{Subtype: records.CareSubtypeDiaper, RecordedAt: validTS}},
	}).RequireError(t, http.StatusBadRequest, "护理记录")

	adminClient.Post(t, batchURL, records.BatchCreateInput{
		Feedings: []records.FeedingInput{{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(90), RecordedAt: futureTS}},
		Cares:    []records.CareInput{{Subtype: records.CareSubtypeDiaper, DiaperKind: ptr("pee"), RecordedAt: validTS}},
	}).RequireError(t, http.StatusBadRequest, "不能晚于当前时间")

	if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
		t.Fatalf("批量校验失败回滚后 feeding_records 应为 0 行，实际 %d", got)
	}
	if got := CountRows[records.CareRecord](t, app, ""); got != 0 {
		t.Fatalf("批量校验失败回滚后 care_records 应为 0 行，实际 %d", got)
	}
}
