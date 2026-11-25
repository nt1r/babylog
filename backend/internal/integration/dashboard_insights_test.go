package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: dashboard-insights / Authenticated access to dashboard endpoints / Reject unauthenticated dashboard request; Reject dashboard request before baby onboarding
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Reject invalid IANA timezone parameter
 * 场景：验证首页看板 summary 与 trends 两个端点的认证门禁（401）、未建档门禁（409）与非法时区参数拒绝（400）。
 * 前置：隔离环境内已初始化管理员，初始未建档；验证 409 后建档再验证非法时区 400。
 * 目标：
 * 1. 验证未认证请求 /api/dashboard/summary 与 /api/dashboard/trends 均返回 401。
 * 2. 验证未建档请求 /api/dashboard/summary 与 /api/dashboard/trends 均返回 409。
 * 3. 验证建档后携带非法 tz=Invalid/Zone 请求两接口均返回 400 中文错误。
 */
func TestDashboardAuthOnboardingAndTimezoneGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	client := app.Client()

	// 1. 未认证返回 401。
	anon.Get(t, "/api/dashboard/summary").RequireError(t, http.StatusUnauthorized, "")
	anon.Get(t, "/api/dashboard/trends").RequireError(t, http.StatusUnauthorized, "")

	// 2. 已认证但未建档返回 409。
	client.Get(t, "/api/dashboard/summary").RequireError(t, http.StatusConflict, "建档")
	client.Get(t, "/api/dashboard/trends").RequireError(t, http.StatusConflict, "建档")

	// 3. 建档后非法 IANA 时区参数返回 400 中文错误。
	app.Scenario().EnsureBaby()
	client.Get(t, "/api/dashboard/summary?tz=Invalid/Zone").RequireError(t, http.StatusBadRequest, "")
	client.Get(t, "/api/dashboard/trends?tz=Invalid/Zone").RequireError(t, http.StatusBadRequest, "")
}

/*
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Compute today summary in specified timezone; Split cross-midnight sleep across local natural days; Aggregate today's medicine count and latest medicine in requested timezone; Independently resolve partial growth measurements and apply birth-profile fallback
 * 场景：验证看板今日摘要的时区归日、跨夜睡眠拆分、多条今日用药聚合，以及独立解析部分生长测量与出生体格兜底。
 * 前置：每项子测试独占隔离 SQLite 与固定时钟。
 * 目标：
 * 1. 验证跨 UTC 日界线喂养（00:30+08）、跨夜睡眠（22:00→06:00 仅计今日 360min）与多条今日用药（today_medicine_count=2、取最新药名与时刻）准确汇总。
 * 2. 验证无手动生长记录时体重/身高兜底出生值；写入旧身高与新体重两条部分记录及两条长牙记录后，各维度独立解析为最新手动值且头围为 null。
 */
func TestDashboardSummaryTimezoneSplitMedicineAndGrowth(t *testing.T) {
	t.Parallel()

	t.Run("正常主流程_跨UTC日界线跨夜睡眠与多条今日用药聚合", func(t *testing.T) {
		t.Parallel()

		// 2026-11-23 16:00:00+08:00（UTC 08:00），便于写入当日 08:30 与 14:00 两条用药记录。
		app := NewTestApp(t, WithClock(time.Date(2026, 11, 23, 8, 0, 0, 0, time.UTC)))
		s := app.Scenario()
		s.EnsureBaby()

		// 写入跨 UTC 日界线凌晨配方奶（11-23 00:30+08）、两条当日亲喂、跨夜睡眠、尿布、体温与跨日/当日用药。
		s.AddFormula(120, "2026-11-22T16:30:00Z")
		s.AddDirectBreast("left", 18, "2026-11-22T16:40:00Z")
		s.AddDirectBreast("right", 12, "2026-11-23T01:30:00Z")
		s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 22:00+08 -> 06:00+08
		s.AddDiaper("both", "", "", "2026-11-23T01:00:00Z")
		s.AddTemperature(36.7, "2026-11-23T01:10:00Z")
		s.AddMedicine("昨日维D", "", "2026-11-22T15:30:00Z")      // 11-22 23:30+08（昨日，不计入今日）
		s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T00:30:00Z") // 11-23 08:30+08
		s.AddMedicine("布洛芬", "2.5 ml", "2026-11-23T06:00:00Z") // 11-23 14:00+08

		// 验证 GET /api/dashboard/summary?tz=Asia/Shanghai 全字段汇总。
		resp := app.Client().Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
		resp.RequireStatus(t, http.StatusOK)
		sum := DecodeJSON[dashboard.SummaryResponse](t, resp)

		if sum.Date != "2026-11-23" || sum.Timezone != "Asia/Shanghai" {
			t.Fatalf("unexpected summary date/tz: %+v", sum)
		}
		if sum.Feeding.TotalML != 120 || sum.Feeding.DirectBreastCount != 2 || sum.Feeding.DirectBreastMin != 30 ||
			sum.Feeding.LastFeedingAt == nil || *sum.Feeding.LastFeedingAt != "2026-11-23T01:30:00Z" {
			t.Errorf("unexpected feeding summary: %+v", sum.Feeding)
		}
		if sum.Sleep.TotalMin != 360 || sum.Sleep.NightMin != 360 {
			t.Errorf("expected today split sleep 360min, got %+v", sum.Sleep)
		}
		if sum.Care.TotalCount != 1 || sum.Care.PeeCount != 1 || sum.Care.PoopCount != 1 || sum.Care.LastDiaperAt == nil {
			t.Errorf("unexpected care summary: %+v", sum.Care)
		}
		if sum.Health.LatestTempC == nil || *sum.Health.LatestTempC != 36.7 ||
			sum.Health.TodayMedicineCount != 2 ||
			sum.Health.LatestMedicineName == nil || *sum.Health.LatestMedicineName != "布洛芬" ||
			sum.Health.LatestMedicineAt == nil || *sum.Health.LatestMedicineAt != "2026-11-23T06:00:00Z" {
			t.Errorf("unexpected health summary: %+v", sum.Health)
		}
	})

	t.Run("边界_跨记录部分生长测量独立解析与出生体格兜底", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		s := app.Scenario()
		s.EnsureBaby(BabyParams{
			BirthDate:     "2026-07-15",
			BirthWeightKg: ptr(3.3),
			BirthHeightCm: ptr(50.0),
		})
		client := app.Client()

		// 尚无手动生长记录时，体重与身高均回落出生体格（is_birth=true，日期等于 birth_date），头围为 null。
		initResp := client.Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
		initResp.RequireStatus(t, http.StatusOK)
		initGrowth := DecodeJSON[dashboard.SummaryResponse](t, initResp).Growth
		if initGrowth.LatestWeightKg == nil || *initGrowth.LatestWeightKg != 3.3 || !initGrowth.WeightIsBirth ||
			initGrowth.WeightRecordedAt == nil || *initGrowth.WeightRecordedAt != "2026-07-15" ||
			initGrowth.LatestHeightCm == nil || *initGrowth.LatestHeightCm != 50.0 || !initGrowth.HeightIsBirth ||
			initGrowth.HeightRecordedAt == nil || *initGrowth.HeightRecordedAt != "2026-07-15" ||
			initGrowth.LatestHeadCm != nil || initGrowth.TeethCount != 0 {
			t.Fatalf("unexpected birth-fallback growth summary: %+v", initGrowth)
		}

		// 仅写一条体重记录时，体重转为手动值，身高仍保持出生兜底。
		s.AddGrowth(GrowthParams{WeightKg: ptr(7.2), RecordedAt: "2026-11-20T04:00:00Z"})
		midResp := client.Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
		midResp.RequireStatus(t, http.StatusOK)
		midGrowth := DecodeJSON[dashboard.SummaryResponse](t, midResp).Growth
		if midGrowth.LatestWeightKg == nil || *midGrowth.LatestWeightKg != 7.2 || midGrowth.WeightIsBirth ||
			midGrowth.LatestHeightCm == nil || *midGrowth.LatestHeightCm != 50.0 || !midGrowth.HeightIsBirth {
			t.Fatalf("unexpected partial weight + birth height summary: %+v", midGrowth)
		}

		// 追加更早的一条仅含身高的生长记录与两条长牙记录，验证体重/身高跨记录独立解析且头围仍为 null。
		s.AddGrowth(GrowthParams{HeightCm: ptr(62.5), RecordedAt: "2026-11-10T04:00:00Z"})
		s.AddTooth("下中切牙（第 1 颗）", "2026-11-15T04:00:00Z")
		s.AddTooth("下中切牙（第 2 颗）", "2026-11-22T04:00:00Z")

		afterResp := client.Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
		afterResp.RequireStatus(t, http.StatusOK)
		afterGrowth := DecodeJSON[dashboard.SummaryResponse](t, afterResp).Growth
		if afterGrowth.LatestWeightKg == nil || *afterGrowth.LatestWeightKg != 7.2 || afterGrowth.WeightIsBirth ||
			afterGrowth.LatestHeightCm == nil || *afterGrowth.LatestHeightCm != 62.5 || afterGrowth.HeightIsBirth ||
			afterGrowth.LatestHeadCm != nil ||
			afterGrowth.TeethCount != 2 || afterGrowth.LatestToothNote == nil || *afterGrowth.LatestToothNote != "下中切牙（第 2 颗）" {
			t.Fatalf("unexpected independent partial growth summary: %+v", afterGrowth)
		}
	})
}

/*
 * Spec: dashboard-insights / Seven-day feeding, sleep, and care rhythm trends / Return contiguous 7-day trend series with zero-filled empty days; Split cross-midnight sleep accurately across consecutive trend days; Aggregate daily direct breastfeeding minutes and counts in local timezone
 * 场景：验证近 7 日连续趋势（空日零填充、跨夜睡眠双日切分、亲喂分钟/次数与奶量分离）及 5 时段照护节律分布。
 * 前置：已建档宝宝，仅在 7 天窗口最后 2 天写入配方奶、跨 UTC 亲喂、跨夜睡眠、尿布与体温记录。
 * 目标：
 * 1. 验证返回连续 7 个有序日桶且前 5 个空日全零填充。
 * 2. 验证跨夜睡眠拆分为 2026-11-22 的 2.0 小时与 2026-11-23 的 6.0 小时；亲喂 30 分钟/2 次计入当日且不混入 feeding_ml。
 * 3. 验证 5 个有序照护节律时段（清晨/上午/下午/傍晚/夜间）分布计数准确。
 * 4. 验证跨 7 天窗口起点的睡眠切分、省略 days 默认 7 天、days=14 日期标签及非法 days 返回 400。
 */
func TestDashboardSevenDayTrendsAndCareRhythm(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	s.EnsureBaby()

	// 前置造数：仅在最近 2 天写入跨 UTC 凌晨记录、跨夜睡眠及上午照护记录。
	s.AddFormula(120, "2026-11-22T16:30:00Z")                                             // 11-23 00:30+08（夜间）
	s.AddDirectBreast("left", 18, "2026-11-22T16:40:00Z")                                 // 11-23 00:40+08（夜间）
	s.AddDirectBreast("right", 12, "2026-11-23T01:30:00Z")                                // 11-23 09:30+08（上午）
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 11-22 22:00+08 入睡（夜间）
	s.AddDiaper("both", "", "", "2026-11-23T01:00:00Z")                                   // 11-23 09:00+08（上午）
	s.AddTemperature(36.7, "2026-11-23T01:10:00Z")                                        // 11-23 09:10+08（上午）

	// 1. 请求 7 日趋势并核验返回连续 7 个有序日桶与前 5 个空日全零填充。
	resp := app.Client().Get(t, "/api/dashboard/trends?days=7&tz=Asia/Shanghai")
	resp.RequireStatus(t, http.StatusOK)
	tr := DecodeJSON[dashboard.TrendsResponse](t, resp)

	if tr.Days != 7 || len(tr.Daily) != 7 {
		t.Fatalf("expected 7 daily points, got days=%d len=%d", tr.Days, len(tr.Daily))
	}
	for i := 0; i < 5; i++ {
		d := tr.Daily[i]
		if d.FeedingML != 0 || d.DirectBreastMin != 0 || d.DirectBreastCount != 0 || d.SleepHours != 0 {
			t.Errorf("expected zero-filled empty day %s, got %+v", d.Date, d)
		}
	}

	// 2. 核验跨夜睡眠双日切分及亲喂分钟/次数与 feeding_ml 分离统计。
	dayPrev, dayToday := tr.Daily[5], tr.Daily[6]
	if dayPrev.Date != "2026-11-22" || dayPrev.SleepHours != 2.0 ||
		dayPrev.FeedingML != 0 || dayPrev.DirectBreastMin != 0 || dayPrev.DirectBreastCount != 0 {
		t.Errorf("unexpected 2026-11-22 trend: %+v", dayPrev)
	}
	if dayToday.Date != "2026-11-23" || dayToday.SleepHours != 6.0 ||
		dayToday.FeedingML != 120 || dayToday.DirectBreastMin != 30 || dayToday.DirectBreastCount != 2 {
		t.Errorf("unexpected 2026-11-23 trend: %+v", dayToday)
	}

	// 3. 核验 5 个有序时段标签与分布计数（夜间=3，上午=3，其余=0）。
	wantOrder := []string{"清晨", "上午", "下午", "傍晚", "夜间"}
	if len(tr.Slots) != len(wantOrder) {
		t.Fatalf("expected 5 ordered slots, got %+v", tr.Slots)
	}
	slotMap := make(map[string]int, len(tr.Slots))
	for i, slot := range tr.Slots {
		if slot.Slot != wantOrder[i] {
			t.Errorf("slot[%d]: expected %q, got %q", i, wantOrder[i], slot.Slot)
		}
		slotMap[slot.Slot] = slot.Count
	}
	if slotMap["夜间"] != 3 || slotMap["上午"] != 3 || slotMap["清晨"] != 0 || slotMap["下午"] != 0 || slotMap["傍晚"] != 0 {
		t.Errorf("unexpected care rhythm slot counts: %+v", tr.Slots)
	}

	// 4. 边界：跨 7 天窗口起点的睡眠（11-16 22:00 → 11-17 06:00）计入 11-17 的 6.0h，但入睡早于窗口起点不计入时段分布；
	//    同时校验省略 days 默认 7 天、days=14 使用 "11/23" 日期标签、越界/非法 days 返回 400。
	s.AddSleep(records.SleepSubtypeNight, "2026-11-16T14:00:00Z", "2026-11-16T22:00:00Z")
	tDefaultResp := app.Client().Get(t, "/api/dashboard/trends?tz=Asia/Shanghai")
	tDefaultResp.RequireStatus(t, http.StatusOK)
	tDefault := DecodeJSON[dashboard.TrendsResponse](t, tDefaultResp)
	if tDefault.Days != 7 || tDefault.Daily[0].Date != "2026-11-17" || tDefault.Daily[0].SleepHours != 6.0 {
		t.Fatalf("expected window-edge sleep 6.0h on 2026-11-17 with default 7d, got days=%d day0=%+v", tDefault.Days, tDefault.Daily[0])
	}
	var nightCount int
	for _, slot := range tDefault.Slots {
		if slot.Slot == "夜间" {
			nightCount = slot.Count
		}
	}
	if nightCount != 3 {
		t.Errorf("sleep starting before 7d window must not be counted in care rhythm slots, got 夜间=%d", nightCount)
	}

	t14Resp := app.Client().Get(t, "/api/dashboard/trends?days=14&tz=Asia/Shanghai")
	t14Resp.RequireStatus(t, http.StatusOK)
	t14 := DecodeJSON[dashboard.TrendsResponse](t, t14Resp)
	if t14.Days != 14 || len(t14.Daily) != 14 || t14.Daily[13].Label != "11/23" {
		t.Errorf("expected 14-day trend with 11/23 label, got days=%d last=%+v", t14.Days, t14.Daily[len(t14.Daily)-1])
	}

	for _, badDays := range []string{"0", "91", "abc"} {
		app.Client().Get(t, "/api/dashboard/trends?days="+badDays+"&tz=Asia/Shanghai").
			RequireError(t, http.StatusBadRequest, "趋势天数")
	}
}
