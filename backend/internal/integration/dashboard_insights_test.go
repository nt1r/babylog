package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Compute today summary in specified timezone; Split cross-midnight sleep across local natural days; Aggregate today's medicine count and latest medicine in requested timezone
 * 测试场景：验证看板今日摘要的东八区归日、跨夜睡眠切分、多条今日用药聚合，以及切换到西八区时同批数据的自然日归属变化。
 * 业务背景：家庭在不同时区查看看板或记录凌晨喂养/跨夜整觉时，今日统计必须严格以请求时区的自然日为准，同时距上次照护与最近体温跨日保留。
 * 前置数据：
 * - 时钟与时区：2026-11-23 16:00+08:00（UTC 08:00，对应 America/Los_Angeles 当日 00:00）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：凌晨跨 UTC 配方奶 120ml、2 条今日亲喂（共 30min）、跨夜整觉（22:00→06:00）、今日尿布、体温 36.7℃、昨日用药 1 条与今日用药 2 条
 * 测试目标：
 * 1. 验证 Asia/Shanghai 查询返回今日完整 KPI（喂养 120ml + 亲喂 2 次 30min、睡眠仅计今日 360min、尿布 1/1/1、今日用药 2 次且最新为布洛芬）。
 * 2. 验证同一批数据切至 America/Los_Angeles（此时刚过零点）查询时，当日计数归零而跨日最近标记（last_feeding_at、latest_temp_c）仍正常返回。
 */
func TestDashboardSummaryTimezoneSplitAndMedicine(t *testing.T) {
	t.Parallel()

	// 固定时钟在 2026-11-23 16:00:00+08:00（UTC 08:00），对应洛杉矶 2026-11-23 00:00:00-08:00。
	app := NewTestApp(t, WithClock(time.Date(2026, 11, 23, 8, 0, 0, 0, time.UTC)))
	s := app.Scenario()
	s.EnsureBaby()

	// 前置造数：写入跨 UTC 凌晨喂养、跨夜睡眠、尿布、体温与跨日/当日用药。
	s.AddFormula(120, "2026-11-22T16:30:00Z")
	s.AddDirectBreast("left", 18, "2026-11-22T16:40:00Z")
	s.AddDirectBreast("right", 12, "2026-11-23T01:30:00Z")
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 22:00+08 → 06:00+08
	s.AddDiaper("both", "", "", "2026-11-23T01:00:00Z")
	s.AddTemperature(36.7, "2026-11-23T01:10:00Z")
	s.AddMedicine("昨日维D", "", "2026-11-22T15:30:00Z")      // 11-22 23:30+08（昨日，不计入东八区今日）
	s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T00:30:00Z") // 11-23 08:30+08
	s.AddMedicine("布洛芬", "2.5 ml", "2026-11-23T06:00:00Z") // 11-23 14:00+08

	// 1. 按 Asia/Shanghai 查询今日摘要，核验全部维度汇总与跨夜睡眠当日切分。
	shResp := app.Client().Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
	shResp.RequireStatus(t, http.StatusOK)
	sum := DecodeOK[dashboard.SummaryResponse](t, shResp)

	if sum.Date != "2026-11-23" {
		t.Fatalf("摘要日期异常：%+v", sum)
	}
	if sum.Feeding.TotalML != 120 || sum.Feeding.DirectBreastCount != 2 || sum.Feeding.DirectBreastMin != 30 ||
		sum.Feeding.LastFeedingAt == nil || *sum.Feeding.LastFeedingAt != "2026-11-23T01:30:00Z" {
		t.Errorf("今日喂养汇总异常：%+v", sum.Feeding)
	}
	if sum.Sleep.TotalMin != 360 || sum.Sleep.NightMin != 360 {
		t.Errorf("跨夜睡眠当日切分预期 360min，实际 %+v", sum.Sleep)
	}
	if sum.Care.TotalCount != 1 || sum.Care.PeeCount != 1 || sum.Care.PoopCount != 1 || sum.Care.LastDiaperAt == nil {
		t.Errorf("今日护理汇总异常：%+v", sum.Care)
	}
	if sum.Health.LatestTempC == nil || *sum.Health.LatestTempC != 36.7 ||
		sum.Health.TodayMedicineCount != 2 ||
		sum.Health.LatestMedicineName == nil || *sum.Health.LatestMedicineName != "布洛芬" ||
		sum.Health.LatestMedicineAt == nil || *sum.Health.LatestMedicineAt != "2026-11-23T06:00:00Z" {
		t.Errorf("今日健康观察汇总异常：%+v", sum.Health)
	}

	// 2. 切换为 America/Los_Angeles（此时恰好刚跨入 11-23 00:00），核验当日统计全部归零而跨日最近标记依然保留。
	laResp := app.Client().Get(t, "/api/dashboard/summary?tz=America/Los_Angeles")
	laResp.RequireStatus(t, http.StatusOK)
	laSum := DecodeOK[dashboard.SummaryResponse](t, laResp)
	if laSum.Date != "2026-11-23" {
		t.Fatalf("西八区日期异常：%+v", laSum)
	}
	if laSum.Feeding.TotalML != 0 || laSum.Sleep.TotalMin != 0 || laSum.Health.TodayMedicineCount != 0 {
		t.Errorf("西八区刚过零点时当日累计应归零，实际 feeding=%+v sleep=%+v health=%+v", laSum.Feeding, laSum.Sleep, laSum.Health)
	}
	if laSum.Feeding.LastFeedingAt == nil || laSum.Health.LatestTempC == nil || *laSum.Health.LatestTempC != 36.7 {
		t.Errorf("跨日最近照护与体温标记不应随新一天清零：feeding=%+v health=%+v", laSum.Feeding, laSum.Health)
	}
}

/*
 * Spec: dashboard-insights / Seven-day feeding, sleep, and care rhythm trends / Return contiguous 7-day trend series with zero-filled empty days; Split cross-midnight sleep accurately across consecutive trend days; Aggregate daily direct breastfeeding minutes and counts in local timezone
 * 测试场景：验证近 7 日连续趋势（空日零填充、跨夜睡眠双日切分、瓶喂计入奶量与亲喂分离）、5 个照护节律全时段覆盖，以及窗口起点边界与 days 参数校验。
 * 业务背景：趋势图表同时展示奶量（配方奶+瓶喂母乳）、亲喂分钟数与睡眠小时数，并按 5 个全天时段呈现照护节律，任何品类混算或窗口起点入睡误计都会导致图表失真。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：仅在近 7 天最后 2 天写入配方奶 120ml、瓶喂母乳 100ml、2 条亲喂（30min）、跨夜整觉（22:00→06:00）、尿布、体温、生长与洗澡记录，覆盖全天 5 个时段
 * 测试目标：
 * 1. 验证返回连续 7 个有序日桶且前 5 个空日全零填充。
 * 2. 验证跨夜睡眠拆分为 11-22 的 2.0h 与 11-23 的 6.0h；配方奶+瓶喂母乳合计 220ml 计入 feeding_ml，亲喂 30min/2次独立统计不混入奶量。
 * 3. 验证 5 个有序照护节律时段（清晨/上午/下午/傍晚/夜间）全部命中且计数准确。
 * 4. 验证跨 7 天窗口起点的睡眠仅切分落入首日的 6.0h 且不计入时段频次；省略 days 默认 7 天、days=14 返回 11/23 标签，非法 days 返回 400。
 */
func TestDashboardSevenDayTrendsAndCareRhythm(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	s.EnsureBaby()

	// 前置造数：仅在最后 2 天写入多品类记录，精确覆盖清晨/上午/下午/傍晚/夜间全部 5 个照护时段。
	s.AddFormula(120, "2026-11-22T16:30:00Z")                                             // 11-23 00:30+08（夜间）
	s.AddDirectBreast("left", 18, "2026-11-22T16:40:00Z")                                 // 11-23 00:40+08（夜间）
	s.AddBottleBreast(100, "2026-11-22T22:30:00Z")                                        // 11-23 06:30+08（清晨）
	s.AddDiaper("both", "", "", "2026-11-23T01:00:00Z")                                   // 11-23 09:00+08（上午）
	s.AddTemperature(36.7, "2026-11-23T01:10:00Z")                                        // 11-23 09:10+08（上午）
	s.AddDirectBreast("right", 12, "2026-11-23T01:30:00Z")                                // 11-23 09:30+08（上午）
	s.AddGrowth(GrowthParams{WeightKg: ptr(7.0), RecordedAt: "2026-11-22T06:00:00Z"})     // 11-22 14:00+08（下午）
	s.AddBath("2026-11-22T11:00:00Z")                                                     // 11-22 19:00+08（傍晚）
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 11-22 22:00+08 入睡（夜间）

	// 1. 请求 7 日趋势，核验连续 7 个日桶且前 5 个空日全零填充。
	resp := app.Client().Get(t, "/api/dashboard/trends?days=7&tz=Asia/Shanghai")
	resp.RequireStatus(t, http.StatusOK)
	tr := DecodeOK[dashboard.TrendsResponse](t, resp)

	if len(tr.Daily) != 7 {
		t.Fatalf("预期返回 7 个趋势日桶，实际 len=%d", len(tr.Daily))
	}
	for i := 0; i < 5; i++ {
		d := tr.Daily[i]
		if d.FeedingML != 0 || d.DirectBreastMin != 0 || d.DirectBreastCount != 0 || d.SleepHours != 0 {
			t.Errorf("空日 %s 预期全零填充，实际 %+v", d.Date, d)
		}
	}

	// 2. 核验跨夜睡眠双日切分，以及瓶喂母乳与配方奶合并为 220ml、亲喂 30min/2次独立统计。
	dayPrev, dayToday := tr.Daily[5], tr.Daily[6]
	if dayPrev.Date != "2026-11-22" || dayPrev.SleepHours != 2.0 ||
		dayPrev.FeedingML != 0 || dayPrev.DirectBreastMin != 0 || dayPrev.DirectBreastCount != 0 {
		t.Errorf("2026-11-22 趋势数据异常：%+v", dayPrev)
	}
	if dayToday.Date != "2026-11-23" || dayToday.SleepHours != 6.0 ||
		dayToday.FeedingML != 220 || dayToday.DirectBreastMin != 30 || dayToday.DirectBreastCount != 2 {
		t.Errorf("2026-11-23 趋势数据异常（预期 feeding_ml=220, direct=30min/2次, sleep=6.0h）：%+v", dayToday)
	}

	// 3. 核验 5 个有序照护节律时段全命中且计数精确（清晨=1、上午=3、下午=1、傍晚=1、夜间=3）。
	wantOrder := []string{"清晨", "上午", "下午", "傍晚", "夜间"}
	if len(tr.Slots) != len(wantOrder) {
		t.Fatalf("预期返回 5 个有序时段，实际 %+v", tr.Slots)
	}
	slotMap := make(map[string]int, len(tr.Slots))
	for i, slot := range tr.Slots {
		if slot.Slot != wantOrder[i] {
			t.Errorf("时段[%d] 预期 %q，实际 %q", i, wantOrder[i], slot.Slot)
		}
		slotMap[slot.Slot] = slot.Count
	}
	if slotMap["清晨"] != 1 || slotMap["上午"] != 3 || slotMap["下午"] != 1 || slotMap["傍晚"] != 1 || slotMap["夜间"] != 3 {
		t.Errorf("照护节律时段计数不符合预期：%+v", tr.Slots)
	}

	// 4. 边界校验：跨 7 天窗口起点的睡眠仅切分 6.0h 到首日 11-17、入睡早于窗口不计入夜间时段；同时核对默认 7d、14d 标签与非法 days 400。
	s.AddSleep(records.SleepSubtypeNight, "2026-11-16T14:00:00Z", "2026-11-16T22:00:00Z")
	tDefaultResp := app.Client().Get(t, "/api/dashboard/trends?tz=Asia/Shanghai")
	tDefaultResp.RequireStatus(t, http.StatusOK)
	tDefault := DecodeOK[dashboard.TrendsResponse](t, tDefaultResp)
	if len(tDefault.Daily) != 7 || tDefault.Daily[0].Date != "2026-11-17" || tDefault.Daily[0].SleepHours != 6.0 {
		t.Fatalf("跨窗口起点睡眠预期在 2026-11-17 计入 6.0h，实际 len=%d daily=%+v", len(tDefault.Daily), tDefault.Daily)
	}
	var nightCount int
	for _, slot := range tDefault.Slots {
		if slot.Slot == "夜间" {
			nightCount = slot.Count
		}
	}
	if nightCount != 3 {
		t.Errorf("入睡早于 7 天窗口起点的睡眠不应计入夜间时段，预期 3，实际 %d", nightCount)
	}

	t14Resp := app.Client().Get(t, "/api/dashboard/trends?days=14&tz=Asia/Shanghai")
	t14Resp.RequireStatus(t, http.StatusOK)
	t14 := DecodeOK[dashboard.TrendsResponse](t, t14Resp)
	if len(t14.Daily) != 14 {
		t.Fatalf("14 天趋势预期返回 14 个日桶，实际 len=%d", len(t14.Daily))
	}
	if t14.Daily[13].Label != "11/23" {
		t.Errorf("14 天趋势预期末日标签 11/23，实际 %+v", t14.Daily[13])
	}

	for _, badDays := range []string{"0", "91", "abc"} {
		app.Client().Get(t, "/api/dashboard/trends?days="+badDays+"&tz=Asia/Shanghai").
			RequireError(t, http.StatusBadRequest, "趋势天数")
	}
}

/*
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Independently resolve partial growth measurements and apply birth-profile fallback
 * Spec: dashboard-insights / Seven-day feeding, sleep, and care rhythm trends / Return contiguous 7-day trend series with zero-filled empty days
 * 测试场景：验证无记录冷启动看板、出生体格兜底，以及体重/身高/头围跨记录独立解析与累计出牙统计。
 * 业务背景：家长体检常只量单一维度（如在家只称体重、儿保才量身高与头围），看板必须对三项体格指标各自独立取最新非空值，并在无手动记录时回退宝宝档案出生值。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：主环境与冷启动环境各自已初始化并登录管理员
 * - 宝宝档案：冷启动环境不填出生体格；主环境出生日 2026-07-15、出生体重 3.3kg、出生身高 50.0cm
 * - 前置业务记录：无（步骤 2–3 依次写入仅含体重、仅含身高、仅含头围的生长记录与 2 条长牙记录）
 * 测试目标：
 * 1. 验证未填出生体格且无任何记录的冷启动宝宝查询 summary 与 trends 均返回全零/全 null 及 7 个全零空日桶、5 个零计数时段。
 * 2. 验证有出生体格但无手动生长记录时，体重与身高回退出生值（is_birth=true，日期等于 birth_date），写入仅体重记录后体重切为手动而身高保持兜底。
 * 3. 验证追加更早的仅身高记录、仅头围记录与 2 条长牙记录后，体重/身高/头围三维度各自独立解析准确且长牙计数为 2。
 */
func TestDashboardGrowthPartialResolutionAndColdStart(t *testing.T) {
	t.Parallel()

	// 1. 冷启动宝宝（无出生体重/身高、无任何日常记录）：验证 summary 全零/全空，且 trends 7 个日桶与 5 个时段逐项全零。
	coldApp := NewTestApp(t)
	coldApp.Scenario().EnsureBaby(BabyParams{WithoutBirthMeasurements: true})
	coldSumResp := coldApp.Client().Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
	coldSumResp.RequireStatus(t, http.StatusOK)
	coldSum := DecodeOK[dashboard.SummaryResponse](t, coldSumResp)
	if coldSum.Feeding.TotalML != 0 || coldSum.Feeding.LastFeedingAt != nil ||
		coldSum.Growth.LatestWeightKg != nil || coldSum.Growth.LatestHeightCm != nil ||
		coldSum.Growth.LatestHeadCm != nil || coldSum.Growth.WeightIsBirth || coldSum.Growth.HeightIsBirth {
		t.Fatalf("无出生体格冷启动摘要应全零/全空：%+v", coldSum)
	}
	coldTrendResp := coldApp.Client().Get(t, "/api/dashboard/trends?days=7&tz=Asia/Shanghai")
	coldTrendResp.RequireStatus(t, http.StatusOK)
	coldTrend := DecodeOK[dashboard.TrendsResponse](t, coldTrendResp)
	if len(coldTrend.Daily) != 7 || len(coldTrend.Slots) != 5 {
		t.Fatalf("冷启动趋势应返回 7 日与 5 时段：daily=%d slots=%d", len(coldTrend.Daily), len(coldTrend.Slots))
	}
	for _, day := range coldTrend.Daily {
		if day.FeedingML != 0 || day.DirectBreastMin != 0 || day.DirectBreastCount != 0 || day.SleepHours != 0 {
			t.Errorf("冷启动空日 %s 预期全零，实际 %+v", day.Date, day)
		}
	}
	for _, slot := range coldTrend.Slots {
		if slot.Count != 0 {
			t.Errorf("冷启动时段 %s 预期计数为 0，实际 %d", slot.Slot, slot.Count)
		}
	}

	// 2. 带出生体格的宝宝：先验证出生值兜底，再写一条仅含体重的手动生长记录验证维度独立切换。
	app := NewTestApp(t)
	s := app.Scenario()
	s.EnsureBaby(BabyParams{
		BirthDate:     "2026-07-15",
		BirthWeightKg: ptr(3.3),
		BirthHeightCm: ptr(50.0),
	})
	client := app.Client()

	initResp := client.Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
	initResp.RequireStatus(t, http.StatusOK)
	initGrowth := DecodeOK[dashboard.SummaryResponse](t, initResp).Growth
	if initGrowth.LatestWeightKg == nil || *initGrowth.LatestWeightKg != 3.3 || !initGrowth.WeightIsBirth ||
		initGrowth.WeightRecordedAt == nil || *initGrowth.WeightRecordedAt != "2026-07-15" ||
		initGrowth.LatestHeightCm == nil || *initGrowth.LatestHeightCm != 50.0 || !initGrowth.HeightIsBirth ||
		initGrowth.HeightRecordedAt == nil || *initGrowth.HeightRecordedAt != "2026-07-15" ||
		initGrowth.LatestHeadCm != nil || initGrowth.TeethCount != 0 {
		t.Fatalf("初始出生体格兜底不符合预期：%+v", initGrowth)
	}

	s.AddGrowth(GrowthParams{WeightKg: ptr(7.2), RecordedAt: "2026-11-20T04:00:00Z"})
	midResp := client.Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
	midResp.RequireStatus(t, http.StatusOK)
	midGrowth := DecodeOK[dashboard.SummaryResponse](t, midResp).Growth
	if midGrowth.LatestWeightKg == nil || *midGrowth.LatestWeightKg != 7.2 || midGrowth.WeightIsBirth ||
		midGrowth.LatestHeightCm == nil || *midGrowth.LatestHeightCm != 50.0 || !midGrowth.HeightIsBirth {
		t.Fatalf("单写体重后应仅体重切为手动、身高保留出生兜底：%+v", midGrowth)
	}

	// 3. 追加更早的仅身高、仅头围测量与 2 条长牙记录，验证体重/身高/头围三维度跨记录独立解析。
	s.AddGrowth(GrowthParams{HeightCm: ptr(62.5), RecordedAt: "2026-11-10T04:00:00Z"})
	s.AddGrowth(GrowthParams{HeadCm: ptr(41.5), RecordedAt: "2026-11-12T04:00:00Z"})
	s.AddTooth("下中切牙（第 1 颗）", "2026-11-15T04:00:00Z")
	s.AddTooth("下中切牙（第 2 颗）", "2026-11-22T04:00:00Z")

	afterResp := client.Get(t, "/api/dashboard/summary?tz=Asia/Shanghai")
	afterResp.RequireStatus(t, http.StatusOK)
	afterGrowth := DecodeOK[dashboard.SummaryResponse](t, afterResp).Growth
	if afterGrowth.LatestWeightKg == nil || *afterGrowth.LatestWeightKg != 7.2 || afterGrowth.WeightIsBirth ||
		afterGrowth.LatestHeightCm == nil || *afterGrowth.LatestHeightCm != 62.5 || afterGrowth.HeightIsBirth ||
		afterGrowth.LatestHeadCm == nil || *afterGrowth.LatestHeadCm != 41.5 || afterGrowth.HeadRecordedAt == nil ||
		afterGrowth.TeethCount != 2 || afterGrowth.LatestToothNote == nil || *afterGrowth.LatestToothNote != "下中切牙（第 2 颗）" {
		t.Fatalf("跨记录独立体格与出牙解析结果异常：%+v", afterGrowth)
	}
}

/*
 * Spec: dashboard-insights / Authenticated access to dashboard endpoints / Reject unauthenticated dashboard request; Reject dashboard request before baby onboarding
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Reject invalid IANA timezone parameter
 * 测试场景：验证首页看板 summary 与 trends 端点的认证门禁（401）、未建档门禁（409）与非法时区拒绝（400）。
 * 业务背景：看板聚合强依赖已登录会话、单宝宝档案及合法 IANA 时区，任一前置不满足都必须及时返回明确中文错误。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员，具备匿名与已登录两套客户端
 * - 宝宝档案：步骤 1–2 未建档；步骤 3 建档后验证非法时区 400
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名请求 /api/dashboard/summary 与 /api/dashboard/trends 均返回 401。
 * 2. 验证已登录但未建档请求两接口均返回 409 中文建档提示。
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
