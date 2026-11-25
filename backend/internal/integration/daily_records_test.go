package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: daily-records / Authenticated access and baby-profile precondition for records / Reject unauthenticated record request; Reject record write before baby onboarding
 * 场景：验证日常记录接口的认证门禁（401）与宝宝建档前置门禁（409）。
 * 前置：隔离环境内已初始化管理员，尚未创建宝宝档案。
 * 目标：
 * 1. 验证未认证请求四类记录接口与智能默认值接口全部返回 401 中文错误。
 * 2. 验证已认证但未建档时写入记录返回 409 中文错误且 SQLite 无脏数据。
 */
func TestRecordsAuthAndOnboardingGates(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	client := app.Client()

	// 1. 未认证访问各记录端点全部返回 401。
	for _, path := range []string{
		"/api/records/feeding",
		"/api/records/sleep",
		"/api/records/care",
		"/api/records/health",
		"/api/records/defaults",
	} {
		anon.Get(t, path).RequireError(t, http.StatusUnauthorized, "")
	}

	// 2. 已认证未建档写入喂养记录返回 409 且不落库。
	client.Post(t, "/api/records/feeding", records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   ptr(120),
		RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusConflict, "建档")

	if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
		t.Fatalf("expected 0 feeding rows before onboarding, got %d", got)
	}
}

/*
 * Spec: daily-records / Feeding record CRUD and structured validation / Create direct breastfeeding record; Create bottled breast milk or formula record; Create solid food record; Reject invalid feeding payload; Update and delete feeding record
 * Spec: daily-records / Sleep record CRUD with backfill validation / Create sleep record from start and end times; Reject invalid sleep time interval
 * Spec: daily-records / Care record CRUD and structured validation / Create diaper record with optional stool details; Create bath or other care record; Reject invalid care payload
 * Spec: daily-records / Health and growth record CRUD / Create temperature record with fever status classification; Create growth record with partial measurements; Reject empty growth or medicine record
 * Spec: daily-records / Authenticated access and baby-profile precondition for records / Reject future record timestamp beyond clock skew
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Reject unknown record ID on update or delete
 * 场景：覆盖四大品类记录的完整 CRUD、跨子类型更新清零可空列、删除回读、未知 ID 404 以及超前 5 分钟时间与非法载荷 400。
 * 前置：每项子测试独占隔离 SQLite 与已建档宝宝（固定时钟 2026-11-23 10:00+08:00）。
 * 目标：
 * 1. 验证喂养/睡眠/护理/健康四大品类的全子类型创建、更新与删除，并通过 API 与 SQLite 双重回读验证落库终态（含切换子类型清空可空列为 NULL）。
 * 2. 验证 PUT 与 DELETE 对不存在 ID 返回 404 中文错误。
 * 3. 验证超前服务端 5 分钟的未来时间与各品类非法载荷返回 400 中文错误且数据库无脏行。
 */
func TestRecordsCRUDSubtypeClearingAndValidation(t *testing.T) {
	t.Parallel()

	t.Run("正常主流程_喂养CRUD跨子类型清零与删除回读", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby()
		client := app.Client()

		// 1. 创建全部喂养形态：亲喂、瓶喂母乳、配方奶、辅食。
		direct := s.AddDirectBreast("left", 15, "2026-11-23T00:00:00Z")
		bottle := s.AddBottleBreast(110, "2026-11-23T00:30:00Z")
		formula := s.AddFormula(120, "2026-11-23T01:00:00Z")
		solid := s.AddSolid("高铁米粉", "半碗", "like", "2026-11-23T01:30:00Z")
		if direct.ID <= 0 || bottle.AmountML == nil || *bottle.AmountML != 110 || formula.ID <= 0 || solid.SolidFood == nil || *solid.SolidFood != "高铁米粉" {
			t.Fatalf("unexpected created feeding records: direct=%+v bottle=%+v formula=%+v solid=%+v", direct, bottle, formula, solid)
		}

		// 2. 将配方奶更新为亲喂，回读 SQLite 确认废弃列 amount_ml 显式置为 NULL。
		updResp := client.Put(t, fmt.Sprintf("/api/records/feeding/%d", formula.ID), records.FeedingInput{
			Subtype:     records.FeedingSubtypeBreast,
			FeedingMode: ptr("direct"),
			BreastSide:  ptr("right"),
			DurationMin: ptr(18),
			RecordedAt:  "2026-11-23T01:00:00Z",
			Note:        "改为亲喂",
		})
		updResp.RequireStatus(t, http.StatusOK)
		persisted := FirstRow[records.FeedingRecord](t, app, "id = ?", formula.ID)
		if persisted.Subtype != records.FeedingSubtypeBreast || persisted.AmountML != nil ||
			persisted.DurationMin == nil || *persisted.DurationMin != 18 || persisted.Note != "改为亲喂" {
			t.Fatalf("expected amount_ml=NULL and direct breast persisted, got %+v", persisted)
		}

		// 3. 删除记录后通过列表 API 与 SQLite 确认彻底移除，不存在 ID 的 PUT/DELETE 返回 404。
		client.Delete(t, fmt.Sprintf("/api/records/feeding/%d", formula.ID)).RequireStatus(t, http.StatusOK)
		if got := CountRows[records.FeedingRecord](t, app, "id = ?", formula.ID); got != 0 {
			t.Fatalf("expected deleted feeding removed from SQLite, count=%d", got)
		}
		listResp := client.Get(t, "/api/records/feeding?range=all&tz=Asia/Shanghai")
		listResp.RequireStatus(t, http.StatusOK)
		if got := DecodeJSON[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](t, listResp).Total; got != 3 {
			t.Fatalf("expected 3 remaining feeding records, got %d", got)
		}

		client.Put(t, "/api/records/feeding/999999", records.FeedingInput{
			Subtype: records.FeedingSubtypeFormula, AmountML: ptr(90), RecordedAt: "2026-11-23T01:00:00Z",
		}).RequireError(t, http.StatusNotFound, "")
		client.Delete(t, "/api/records/feeding/999999").RequireError(t, http.StatusNotFound, "")
	})

	t.Run("正常主流程_睡眠CRUD时长重算与删除回读", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby()
		client := app.Client()

		// 1. 创建 45 分钟小睡，验证服务端自动计算 duration_min。
		nap := s.AddSleep(records.SleepSubtypeNap, "2026-11-23T00:15:00Z", "2026-11-23T01:00:00Z")
		if nap.DurationMin != 45 {
			t.Fatalf("expected server-computed duration_min=45, got %d", nap.DurationMin)
		}

		// 2. 更新起止时间为 60 分钟并回读 SQLite 验证 duration_min 同步重算。
		client.Put(t, fmt.Sprintf("/api/records/sleep/%d", nap.ID), records.SleepInput{
			Subtype:   records.SleepSubtypeNap,
			StartedAt: "2026-11-23T00:00:00Z",
			EndedAt:   "2026-11-23T01:00:00Z",
			Note:      "睡得很香",
		}).RequireStatus(t, http.StatusOK)
		persisted := FirstRow[records.SleepRecord](t, app, "id = ?", nap.ID)
		if persisted.DurationMin != 60 || persisted.Note != "睡得很香" {
			t.Fatalf("expected persisted sleep duration_min=60, got %+v", persisted)
		}

		// 3. 删除后回读确认移除，不存在 ID 返回 404。
		client.Delete(t, fmt.Sprintf("/api/records/sleep/%d", nap.ID)).RequireStatus(t, http.StatusOK)
		if got := CountRows[records.SleepRecord](t, app, "id = ?", nap.ID); got != 0 {
			t.Fatalf("expected deleted sleep removed, count=%d", got)
		}
		client.Put(t, "/api/records/sleep/999999", records.SleepInput{
			Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T00:00:00Z", EndedAt: "2026-11-23T00:30:00Z",
		}).RequireError(t, http.StatusNotFound, "")
		client.Delete(t, "/api/records/sleep/999999").RequireError(t, http.StatusNotFound, "")
	})

	t.Run("正常主流程_护理CRUD便便改嘘嘘清零与洗澡回读", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby()
		client := app.Client()

		// 1. 创建便便尿布、洗澡与自定义护理。
		poop := s.AddDiaper("poop", "soft", "yellow", "2026-11-23T01:00:00Z")
		bath := s.AddBath("2026-11-23T01:10:00Z")
		other := s.AddOtherCare("剪指甲", "2026-11-23T01:20:00Z")
		if poop.StoolConsistency == nil || *poop.StoolConsistency != "soft" || bath.Subtype != records.CareSubtypeBath || other.CareTitle == nil || *other.CareTitle != "剪指甲" {
			t.Fatalf("unexpected created care records: poop=%+v bath=%+v other=%+v", poop, bath, other)
		}

		// 2. 将便便更新为纯嘘嘘，回读 SQLite 验证 stool_consistency 与 stool_color 均清空为 NULL。
		client.Put(t, fmt.Sprintf("/api/records/care/%d", poop.ID), records.CareInput{
			Subtype:    records.CareSubtypeDiaper,
			DiaperKind: ptr("pee"),
			RecordedAt: "2026-11-23T01:00:00Z",
		}).RequireStatus(t, http.StatusOK)
		persisted := FirstRow[records.CareRecord](t, app, "id = ?", poop.ID)
		if persisted.DiaperKind == nil || *persisted.DiaperKind != "pee" ||
			persisted.StoolConsistency != nil || persisted.StoolColor != nil {
			t.Fatalf("expected stool columns cleared to NULL on pee update, got %+v", persisted)
		}

		// 3. 删除后回读确认移除，不存在 ID 返回 404。
		client.Delete(t, fmt.Sprintf("/api/records/care/%d", poop.ID)).RequireStatus(t, http.StatusOK)
		if got := CountRows[records.CareRecord](t, app, "id = ?", poop.ID); got != 0 {
			t.Fatalf("expected deleted care removed, count=%d", got)
		}
		client.Put(t, "/api/records/care/999999", records.CareInput{
			Subtype: records.CareSubtypeBath, RecordedAt: "2026-11-23T01:00:00Z",
		}).RequireError(t, http.StatusNotFound, "")
		client.Delete(t, "/api/records/care/999999").RequireError(t, http.StatusNotFound, "")
	})

	t.Run("正常主流程_健康与生长CRUD及跨子类型清零回读", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby()
		client := app.Client()

		// 1. 创建体温（发烧 38.6）、用药、部分测量生长记录与长牙记录。
		temp := s.AddTemperature(38.6, "2026-11-23T01:00:00Z")
		med := s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T01:10:00Z")
		growth := s.AddGrowth(GrowthParams{WeightKg: ptr(6.9), RecordedAt: "2026-11-23T01:20:00Z"})
		tooth := s.AddTooth("下中切牙（第 1 颗）", "2026-11-23T01:30:00Z")
		if temp.TemperatureC == nil || *temp.TemperatureC != 38.6 || med.ID <= 0 || growth.ID <= 0 || tooth.ID <= 0 {
			t.Fatalf("unexpected created health records: temp=%+v med=%+v growth=%+v tooth=%+v", temp, med, growth, tooth)
		}

		// 2. 将体温记录更新为生长记录，回读 SQLite 确认 temperature_c 清空为 NULL、weight_kg 落库。
		client.Put(t, fmt.Sprintf("/api/records/health/%d", temp.ID), records.HealthInput{
			Subtype:    records.HealthSubtypeGrowth,
			WeightKg:   ptr(7.2),
			RecordedAt: "2026-11-23T01:00:00Z",
		}).RequireStatus(t, http.StatusOK)
		persisted := FirstRow[records.HealthRecord](t, app, "id = ?", temp.ID)
		if persisted.Subtype != records.HealthSubtypeGrowth || persisted.TemperatureC != nil ||
			persisted.WeightKg == nil || *persisted.WeightKg != 7.2 {
			t.Fatalf("expected temperature_c=NULL and weight_kg=7.2 after subtype switch, got %+v", persisted)
		}

		// 3. 删除后回读确认移除，不存在 ID 返回 404。
		client.Delete(t, fmt.Sprintf("/api/records/health/%d", growth.ID)).RequireStatus(t, http.StatusOK)
		if got := CountRows[records.HealthRecord](t, app, "id = ?", growth.ID); got != 0 {
			t.Fatalf("expected deleted health removed, count=%d", got)
		}
		client.Put(t, "/api/records/health/999999", records.HealthInput{
			Subtype: records.HealthSubtypeTemperature, TemperatureC: ptr(36.8), RecordedAt: "2026-11-23T01:00:00Z",
		}).RequireError(t, http.StatusNotFound, "")
		client.Delete(t, "/api/records/health/999999").RequireError(t, http.StatusNotFound, "")
	})

	t.Run("拒绝_未来时间超前5分钟与四大品类非法载荷", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		app.Scenario().EnsureBaby()
		client := app.Client()

		// defaultFixedNow 为 2026-11-23T02:00:00Z，+6 分钟即超前 5 分钟容忍上限。
		futureTS := "2026-11-23T02:06:00Z"
		validTS := "2026-11-23T01:00:00Z"

		// 1. 喂养非法载荷（含未来时间、配方奶缺量/<=0、辅食空名）。
		for _, in := range []records.FeedingInput{
			{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(120), RecordedAt: futureTS},
			{Subtype: records.FeedingSubtypeFormula, RecordedAt: validTS},
			{Subtype: records.FeedingSubtypeFormula, AmountML: ptr(0), RecordedAt: validTS},
			{Subtype: records.FeedingSubtypeSolid, SolidFood: ptr("   "), RecordedAt: validTS},
		} {
			client.Post(t, "/api/records/feeding", in).RequireError(t, http.StatusBadRequest, "")
		}
		if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
			t.Fatalf("expected 0 feeding rows after 400 rejections, got %d", got)
		}

		// 2. 睡眠非法载荷（ended_at <= started_at、时长 >24h、ended_at 超前 >5 分钟）。
		for _, in := range []records.SleepInput{
			{Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T01:00:00Z", EndedAt: "2026-11-23T01:00:00Z"},
			{Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T01:30:00Z", EndedAt: "2026-11-23T01:00:00Z"},
			{Subtype: records.SleepSubtypeNight, StartedAt: "2026-11-21T00:00:00Z", EndedAt: "2026-11-22T01:00:00Z"},
			{Subtype: records.SleepSubtypeNap, StartedAt: "2026-11-23T01:30:00Z", EndedAt: futureTS},
		} {
			client.Post(t, "/api/records/sleep", in).RequireError(t, http.StatusBadRequest, "")
		}
		if got := CountRows[records.SleepRecord](t, app, ""); got != 0 {
			t.Fatalf("expected 0 sleep rows after 400 rejections, got %d", got)
		}

		// 3. 护理非法载荷（diaper 缺 diaper_kind、other 空 care_title）。
		for _, in := range []records.CareInput{
			{Subtype: records.CareSubtypeDiaper, RecordedAt: validTS},
			{Subtype: records.CareSubtypeOther, CareTitle: ptr("   "), RecordedAt: validTS},
		} {
			client.Post(t, "/api/records/care", in).RequireError(t, http.StatusBadRequest, "")
		}
		if got := CountRows[records.CareRecord](t, app, ""); got != 0 {
			t.Fatalf("expected 0 care rows after 400 rejections, got %d", got)
		}

		// 4. 健康非法载荷（空生长测量、空药名、空长牙备注、越界体温）。
		for _, in := range []records.HealthInput{
			{Subtype: records.HealthSubtypeGrowth, RecordedAt: validTS},
			{Subtype: records.HealthSubtypeMedicine, MedicineName: ptr("   "), RecordedAt: validTS},
			{Subtype: records.HealthSubtypeTeeth, ToothNote: ptr(""), RecordedAt: validTS},
			{Subtype: records.HealthSubtypeTemperature, TemperatureC: ptr(33.0), RecordedAt: validTS},
		} {
			client.Post(t, "/api/records/health", in).RequireError(t, http.StatusBadRequest, "")
		}
		if got := CountRows[records.HealthRecord](t, app, ""); got != 0 {
			t.Fatalf("expected 0 health rows after 400 rejections, got %d", got)
		}
	})
}

/*
 * Spec: daily-records / Filtered, timezone-scoped listing with pagination and daily subtotals / Filter feeding records by subtype and date range; Filter health records by comma-separated subtype group; Reject invalid or empty token in comma-separated health subtype filter
 * 场景：验证时区感知筛选、不受分页截断的完整每日小计、稀疏 range=all 跨月小计，以及健康逗号多子类型筛选与非法 token 拒绝。
 * 前置：已建档宝宝与跨 UTC 日界线、跨月及全健康子类型的混合记录。
 * 目标：
 * 1. 验证 formula + range=7d + limit=1 时返回 1 条记录，但 2026-11-23 小计完整汇总当日两条（270ml）。
 * 2. 验证稀疏 range=all 跨月分页小计准确汇总同日未落入当前页的记录。
 * 3. 验证 health 逗号多子类型（temperature,medicine / growth,teeth）严格隔离记录与小计，非法/空 token 返回 400。
 */
func TestRecordsFilteringPaginationAndDailySummaries(t *testing.T) {
	t.Parallel()

	t.Run("喂养筛选分页不截断小计与稀疏跨月聚合", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby()
		client := app.Client()

		// 1. 写入跨 UTC 日界线与跨月喂养记录：2026-11-22T17:00Z == 2026-11-23 01:00+08（属本地今天）。
		s.AddFormula(120, "2026-11-23T01:00:00Z") // 11-23 09:00+08
		s.AddFormula(150, "2026-11-22T17:00:00Z") // 11-23 01:00+08
		s.AddFormula(120, "2026-11-22T10:00:00Z") // 11-22 18:00+08
		s.AddFormula(80, "2026-05-01T00:00:00Z")  // 05-01 08:00+08（7d 窗口外）
		s.AddFormula(70, "2026-05-01T06:00:00Z")  // 05-01 14:00+08（7d 窗口外）
		s.AddDirectBreast("left", 18, "2026-11-23T00:00:00Z")

		// 2. range=7d & subtype=formula & limit=1：仅返回 1 条，但 11-23 当日小计必须完整为 270ml/2 次。
		page1Resp := client.Get(t, "/api/records/feeding?subtype=formula&range=7d&tz=Asia/Shanghai&limit=1&offset=0")
		page1Resp.RequireStatus(t, http.StatusOK)
		page1 := DecodeJSON[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](t, page1Resp)
		if page1.Total != 3 || !page1.HasMore || len(page1.Items) != 1 {
			t.Fatalf("unexpected 7d formula pagination: total=%d hasMore=%v len=%d", page1.Total, page1.HasMore, len(page1.Items))
		}
		if sum := page1.DailySummaries["2026-11-23"]; sum.TotalML != 270 || sum.TotalCount != 2 {
			t.Fatalf("expected non-truncated 2026-11-23 summary 270ml/2, got %+v", sum)
		}

		// 3. range=all & subtype=formula & limit=4：跨月命中 05-01 仅 1 条（70ml），但 05-01 小计应完整为 150ml。
		sparseResp := client.Get(t, "/api/records/feeding?subtype=formula&range=all&tz=Asia/Shanghai&limit=4&offset=0")
		sparseResp.RequireStatus(t, http.StatusOK)
		sparse := DecodeJSON[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](t, sparseResp)
		if sparse.Total != 5 || !sparse.HasMore || sparse.DailySummaries["2026-05-01"].TotalML != 150 {
			t.Fatalf("unexpected sparse range=all summaries: total=%d sum=%+v", sparse.Total, sparse.DailySummaries)
		}
	})

	t.Run("健康逗号多子类型筛选隔离与非法token拒绝", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby()
		client := app.Client()

		// 1. 写入全部 4 类健康记录（含一条昨日用药）。
		s.AddTemperature(37.8, "2026-11-23T01:00:00Z")
		s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T01:20:00Z")
		s.AddMedicine("昨日用药", "", "2026-11-22T08:00:00Z")
		s.AddGrowth(GrowthParams{WeightKg: ptr(7.1), RecordedAt: "2026-11-20T04:00:00Z"})
		s.AddTooth("下中切牙（第 1 颗）", "2026-11-21T04:00:00Z")

		// 2. temperature,medicine 筛选仅包含体温与用药，且 daily_summaries 不计入生长/长牙。
		clinResp := client.Get(t, "/api/records/health?subtype=temperature,medicine&range=30d&tz=Asia/Shanghai")
		clinResp.RequireStatus(t, http.StatusOK)
		clin := DecodeJSON[records.ListResult[records.HealthRecord, records.HealthDailySummary]](t, clinResp)
		sumToday := clin.DailySummaries["2026-11-23"]
		if clin.Total != 3 || sumToday.TotalCount != 2 || sumToday.MedicineCount != 1 ||
			sumToday.GrowthCount != 0 || sumToday.TeethCount != 0 ||
			sumToday.LatestTempC == nil || *sumToday.LatestTempC != 37.8 {
			t.Fatalf("unexpected clinical list: total=%d sum=%+v", clin.Total, clin.DailySummaries)
		}

		// 3. growth,teeth 筛选仅包含生长与长牙记录。
		growthResp := client.Get(t, "/api/records/health?subtype=growth,teeth&range=all&tz=Asia/Shanghai")
		growthResp.RequireStatus(t, http.StatusOK)
		growth := DecodeJSON[records.ListResult[records.HealthRecord, records.HealthDailySummary]](t, growthResp)
		if growth.Total != 2 || len(growth.Items) != 2 {
			t.Fatalf("expected 2 growth/teeth records, got total=%d len=%d", growth.Total, len(growth.Items))
		}

		// 4. 非法或含空项的多子类型参数返回 400 中文错误。
		for _, bad := range []string{"temperature,unknown", "growth,", ",teeth", "all,growth"} {
			client.Get(t, "/api/records/health?subtype="+bad).RequireError(t, http.StatusBadRequest, "子类型")
		}
	})
}

/*
 * Spec: daily-records / Smart defaults endpoint for low-friction entry / Return sensible starter defaults when history is empty; Compute smart defaults from recent history
 * 场景：验证空历史兜底预设与多品类真实历史记录下的智能默认值推导。
 * 前置：已建档宝宝；先查空库，再通过 Scenario 写入完整多品类历史。
 * 目标：
 * 1. 验证空历史下返回合理 starter 预设（奶量 90ml、last_milk_subtype=formula、direct/15min、nap=60/night=480、体温 36.6）。
 * 2. 验证有历史后准确返回 last_milk_subtype、top-3 奶量、亲喂换侧（right→left）、去重配对辅食、中位数睡眠时长、最近体温、常用药与自定义护理。
 */
func TestRecordsSmartDefaults(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	s.EnsureBaby()
	client := app.Client()

	// 1. 空历史返回合理兜底预设。
	emptyResp := client.Get(t, "/api/records/defaults")
	emptyResp.RequireStatus(t, http.StatusOK)
	starter := DecodeJSON[records.SmartDefaults](t, emptyResp)
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
		len(starter.Feeding.FrequentMilkML) != 3 {
		t.Fatalf("unexpected starter defaults: %+v", starter)
	}

	// 2. 写入完整习惯历史：频次奶量、亲喂 + 瓶喂母乳、重复带份量辅食、多条小睡/夜觉（验证中位数）、体温、用药与护理。
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

	s.AddTemperature(37.4, "2026-11-23T01:05:00Z")
	s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T01:15:00Z")
	s.AddOtherCare("剪指甲", "2026-11-23T01:20:00Z")

	popResp := client.Get(t, "/api/records/defaults")
	popResp.RequireStatus(t, http.StatusOK)
	got := DecodeJSON[records.SmartDefaults](t, popResp)

	if got.Feeding.LastMilkML != 180 || got.Feeding.LastFeedingSubtype != records.FeedingSubtypeSolid ||
		got.Feeding.LastMilkSubtype != records.FeedingSubtypeBreast {
		t.Errorf("unexpected milk/subtype defaults: %+v", got.Feeding)
	}
	if got.Feeding.LastBreastMode != "bottle" || got.Feeding.LastBreastDurationMin != 12 {
		t.Errorf("unexpected breast mode/duration: %+v", got.Feeding)
	}
	if got.Feeding.LastBreastSide == nil || *got.Feeding.LastBreastSide != "right" || got.Feeding.SuggestedBreastSide != "left" {
		t.Errorf("expected right->left breast side suggestion, got %+v", got.Feeding)
	}
	wantFreq := []int{60, 150, 180}
	if len(got.Feeding.FrequentMilkML) != 3 ||
		got.Feeding.FrequentMilkML[0] != wantFreq[0] ||
		got.Feeding.FrequentMilkML[1] != wantFreq[1] ||
		got.Feeding.FrequentMilkML[2] != wantFreq[2] {
		t.Errorf("expected frequent_milk_ml=%v, got %v", wantFreq, got.Feeding.FrequentMilkML)
	}
	if len(got.Feeding.RecentSolids) != 5 || got.Feeding.RecentSolids[0].Food != "香蕉泥" || got.Feeding.RecentSolids[0].Amount != "半根" {
		t.Errorf("expected deduplicated recent_solids starting with 香蕉泥(半根), got %+v", got.Feeding.RecentSolids)
	}
	if got.Sleep.SuggestedNapMin != 45 || got.Sleep.SuggestedNightMin != 570 {
		t.Errorf("expected median sleep defaults nap=45 night=570, got %+v", got.Sleep)
	}
	if got.Health.LastTemperatureC != 37.4 || len(got.Health.RecentMedicines) != 1 || got.Health.RecentMedicines[0].Name != "维生素 D3" {
		t.Errorf("unexpected health defaults: %+v", got.Health)
	}
	if len(got.Care.RecentOtherTitles) != 1 || got.Care.RecentOtherTitles[0] != "剪指甲" {
		t.Errorf("unexpected care defaults: %+v", got.Care)
	}
}
