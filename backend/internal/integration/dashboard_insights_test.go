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
	b := s.EnsureBaby()
	summaryBase := babyPath(b.ID, "/dashboard/summary")

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
	shResp := app.Client().Get(t, summaryBase+"?tz=Asia/Shanghai")
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
	laResp := app.Client().Get(t, summaryBase+"?tz=America/Los_Angeles")
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
 * 4. 验证跨 7 天窗口起点的睡眠仅切分落入首日的 6.0h 且不计入时段频次；省略 days 默认 7 天、days=1/14/90 合法边界正确，非法 days 返回 400。
 */
func TestDashboardSevenDayTrendsAndCareRhythm(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	trendsBase := babyPath(b.ID, "/dashboard/trends")

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
	resp := app.Client().Get(t, trendsBase+"?days=7&tz=Asia/Shanghai")
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
	tDefaultResp := app.Client().Get(t, trendsBase+"?tz=Asia/Shanghai")
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

	t14Resp := app.Client().Get(t, trendsBase+"?days=14&tz=Asia/Shanghai")
	t14Resp.RequireStatus(t, http.StatusOK)
	t14 := DecodeOK[dashboard.TrendsResponse](t, t14Resp)
	if len(t14.Daily) != 14 {
		t.Fatalf("14 天趋势预期返回 14 个日桶，实际 len=%d", len(t14.Daily))
	}
	if t14.Daily[13].Label != "11/23" {
		t.Errorf("14 天趋势预期末日标签 11/23，实际 %+v", t14.Daily[13])
	}

	// 验证合法天数上下限边界：days=1 返回单日 2026-11-23，days=90 返回 90 个日桶且末日标签 11/23。
	t1 := DecodeOK[dashboard.TrendsResponse](t, app.Client().Get(t, trendsBase+"?days=1&tz=Asia/Shanghai"))
	if len(t1.Daily) != 1 || t1.Daily[0].Date != "2026-11-23" {
		t.Fatalf("days=1 边界预期返回 1 个日桶（2026-11-23），实际 %+v", t1.Daily)
	}
	t90 := DecodeOK[dashboard.TrendsResponse](t, app.Client().Get(t, trendsBase+"?days=90&tz=Asia/Shanghai"))
	if len(t90.Daily) != 90 || t90.Daily[89].Label != "11/23" {
		t.Fatalf("days=90 边界预期返回 90 个日桶且末日标签 11/23，实际 len=%d", len(t90.Daily))
	}

	for _, badDays := range []string{"0", "91", "abc"} {
		app.Client().Get(t, trendsBase+"?days="+badDays+"&tz=Asia/Shanghai").
			RequireError(t, http.StatusBadRequest, "趋势天数")
	}
}

/*
 * Spec: dashboard-insights / Multi-dimension trend breakdown and period insights / Break down feeding, sleep, care, and health metrics per local day; Compute period summary for side balance, solid acceptance, sleep continuity, stool flags, and active days
 * 测试场景：验证 30 日多维趋势拆解（配方奶/瓶喂母乳/亲喂/辅食、白天小睡/夜间睡眠、嘘嘘/便便/洗澡、最高体温与用药）及周期洞察摘要（含空窗冷启动）。
 * 业务背景：统计分析页支持近 30 天等多维图表，需在不破坏原有字段的前提下准确拆分各品类每日数据与周期级指标（亲喂侧别均衡、辅食接受度、最长连续夜觉、小睡均长与便便关注提示）。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：主环境与空窗环境各自已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：主环境在近 30 天内写入配方奶、瓶喂母乳、左/右/双侧亲喂、带接受度辅食、2 段白天小睡、跨夜整觉、各类尿布（含稀便/干硬/异常颜色）、洗澡、同日多条体温与用药；空窗环境无记录
 * 测试目标：
 * 1. 验证 30 日每日桶准确拆解喂养、睡眠、护理与健康分项，且无体温日 max_temp_c 为 null。
 * 2. 验证 period_summary 准确汇总有效记录天数、亲喂侧别分布、辅食接受度、最长夜觉/小睡均长与便便观察计数。
 * 3. 验证空窗冷启动查询 30 日趋势时 period_summary 各项归零且全部每日桶零填充无异常。
 */
func TestDashboardMultiDimensionTrendsAndPeriodSummary(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	trendsBase := babyPath(b.ID, "/dashboard/trends")

	// 前置造数：在 2026-11-21、11-22、11-23 三天写入完整多品类样本覆盖全部新拆解维度。
	s.AddFormula(120, "2026-11-23T00:10:00Z")                                             // 11-23 08:10+08
	s.AddFormula(90, "2026-11-23T01:10:00Z")                                              // 11-23 09:10+08
	s.AddBottleBreast(80, "2026-11-23T01:20:00Z")                                         // 11-23 09:20+08
	s.AddDirectBreast("left", 15, "2026-11-23T01:30:00Z")                                 // 11-23 09:30+08
	s.AddDirectBreast("right", 12, "2026-11-22T02:00:00Z")                                // 11-22 10:00+08
	s.AddDirectBreast("both", 20, "2026-11-22T06:00:00Z")                                 // 11-22 14:00+08
	s.AddSolid("米粉", "半碗", "like", "2026-11-23T01:40:00Z")                                // 11-23 09:40+08
	s.AddSolid("南瓜泥", "两勺", "neutral", "2026-11-22T04:00:00Z")                            // 11-22 12:00+08
	s.AddSolid("西兰花泥", "一口", "dislike", "2026-11-21T04:00:00Z")                           // 11-21 12:00+08
	s.AddSleep(records.SleepSubtypeNap, "2026-11-22T01:00:00Z", "2026-11-22T02:00:00Z")   // 11-22 60min 小睡
	s.AddSleep(records.SleepSubtypeNap, "2026-11-22T06:30:00Z", "2026-11-22T08:00:00Z")   // 11-22 90min 小睡
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 11-22 22:00→11-23 06:00（480min 夜觉，切分 2.0h/6.0h）
	s.AddDiaper("pee", "", "", "2026-11-23T00:30:00Z")                                    // 11-23 嘘嘘
	s.AddDiaper("poop", "watery", "yellow", "2026-11-23T01:00:00Z")                       // 11-23 稀便
	s.AddDiaper("both", "hard", "abnormal", "2026-11-22T05:00:00Z")                       // 11-22 混合+干硬+异常色
	s.AddBath("2026-11-22T12:00:00Z")                                                     // 11-22 洗澡
	s.AddTemperature(37.4, "2026-11-23T00:40:00Z")                                        // 11-23 体温 1
	s.AddTemperature(38.6, "2026-11-23T01:50:00Z")                                        // 11-23 体温 2（当日峰值）
	s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T00:50:00Z")                                // 11-23 用药 1
	s.AddMedicine("布洛芬", "2.5 ml", "2026-11-23T01:55:00Z")                                // 11-23 用药 2

	// 1. 请求近 30 天趋势，校验 11-22 与 11-23 每日分项拆解及无体温日 max_temp_c 保持 null。
	resp := app.Client().Get(t, trendsBase+"?days=30&tz=Asia/Shanghai")
	resp.RequireStatus(t, http.StatusOK)
	tr := DecodeOK[dashboard.TrendsResponse](t, resp)
	if len(tr.Daily) != 30 {
		t.Fatalf("预期返回 30 个日桶，实际 len=%d", len(tr.Daily))
	}

	day22 := tr.Daily[28]
	day23 := tr.Daily[29]
	if day22.Date != "2026-11-22" || day23.Date != "2026-11-23" {
		t.Fatalf("末两日日期键异常：day22=%s day23=%s", day22.Date, day23.Date)
	}
	if day23.FeedingML != 290 || day23.FormulaML != 210 || day23.FormulaCount != 2 ||
		day23.BottleBreastML != 80 || day23.BottleBreastCount != 1 ||
		day23.DirectBreastMin != 15 || day23.DirectBreastCount != 1 ||
		day23.SolidCount != 1 || day23.FeedingCount != 5 {
		t.Errorf("2026-11-23 喂养拆解异常：%+v", day23)
	}
	if day22.NapHours != 2.5 || day22.NightHours != 2.0 || day22.SleepHours != 4.5 || day22.NapCount != 2 {
		t.Errorf("2026-11-22 昼夜睡眠拆解异常：%+v", day22)
	}
	if day23.NapHours != 0 || day23.NightHours != 6.0 || day23.SleepHours != 6.0 || day23.NapCount != 0 {
		t.Errorf("2026-11-23 跨夜睡眠拆解异常：%+v", day23)
	}
	if day22.PeeCount != 1 || day22.PoopCount != 1 || day22.BathCount != 1 ||
		day23.PeeCount != 1 || day23.PoopCount != 1 || day23.BathCount != 0 {
		t.Errorf("护理拆解异常：day22=%+v day23=%+v", day22, day23)
	}
	if day22.MaxTempC != nil || day22.MedicineCount != 0 {
		t.Errorf("无体温/用药日 2026-11-22 预期 max_temp_c=nil 且 medicine_count=0，实际 %+v", day22)
	}
	if day23.MaxTempC == nil || *day23.MaxTempC != 38.6 || day23.MedicineCount != 2 {
		t.Errorf("2026-11-23 健康观察拆解预期 max_temp_c=38.6 且 medicine_count=2，实际 %+v", day23)
	}

	// 2. 校验周期级洞察 period_summary 的各项统计结果。
	ps := tr.PeriodSummary
	if ps.ActiveDays.FeedingDays != 3 || ps.ActiveDays.SleepDays != 2 || ps.ActiveDays.CareDays != 2 {
		t.Errorf("有效记录天数异常：%+v", ps.ActiveDays)
	}
	if ps.BreastSide.LeftCount != 1 || ps.BreastSide.RightCount != 1 || ps.BreastSide.BothCount != 1 {
		t.Errorf("亲喂侧别分布异常：%+v", ps.BreastSide)
	}
	if ps.SolidAcceptance.LikeCount != 1 || ps.SolidAcceptance.NeutralCount != 1 || ps.SolidAcceptance.DislikeCount != 1 {
		t.Errorf("辅食接受度分布异常：%+v", ps.SolidAcceptance)
	}
	if ps.Sleep.LongestNightMin != 480 || ps.Sleep.AvgNapMin != 75 {
		t.Errorf("周期睡眠连续性异常（预期 longest_night=480, avg_nap=75）：%+v", ps.Sleep)
	}
	if ps.Stool.TotalPoopCount != 2 || ps.Stool.WateryCount != 1 || ps.Stool.HardCount != 1 || ps.Stool.AbnormalColorCount != 1 {
		t.Errorf("周期便便观察统计异常：%+v", ps.Stool)
	}

	// 3. 验证空窗冷启动宝宝查询 30 天趋势时 period_summary 归零且每日桶零填充。
	emptyApp := NewTestApp(t)
	emptyBaby := emptyApp.Scenario().EnsureBaby()
	emptyResp := emptyApp.Client().Get(t, babyPath(emptyBaby.ID, "/dashboard/trends?days=30&tz=Asia/Shanghai"))
	emptyResp.RequireStatus(t, http.StatusOK)
	emptyTrend := DecodeOK[dashboard.TrendsResponse](t, emptyResp)
	if len(emptyTrend.Daily) != 30 {
		t.Fatalf("空窗 30 日趋势预期 30 个日桶，实际 %d", len(emptyTrend.Daily))
	}
	if emptyTrend.PeriodSummary != (dashboard.PeriodTrendSummary{}) {
		t.Errorf("空窗期 period_summary 预期全零，实际 %+v", emptyTrend.PeriodSummary)
	}
	for _, day := range emptyTrend.Daily {
		if day.FeedingCount != 0 || day.SleepHours != 0 || day.PeeCount != 0 || day.PoopCount != 0 || day.MaxTempC != nil {
			t.Errorf("空窗日桶 %s 存在非零残留：%+v", day.Date, day)
		}
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
	coldBaby := coldApp.Scenario().EnsureBaby(BabyParams{WithoutBirthMeasurements: true})
	coldSumResp := coldApp.Client().Get(t, babyPath(coldBaby.ID, "/dashboard/summary?tz=Asia/Shanghai"))
	coldSumResp.RequireStatus(t, http.StatusOK)
	coldSum := DecodeOK[dashboard.SummaryResponse](t, coldSumResp)
	if coldSum.Feeding.TotalML != 0 || coldSum.Feeding.LastFeedingAt != nil ||
		coldSum.Growth.LatestWeightKg != nil || coldSum.Growth.LatestHeightCm != nil ||
		coldSum.Growth.LatestHeadCm != nil || coldSum.Growth.WeightIsBirth || coldSum.Growth.HeightIsBirth {
		t.Fatalf("无出生体格冷启动摘要应全零/全空：%+v", coldSum)
	}
	coldTrendResp := coldApp.Client().Get(t, babyPath(coldBaby.ID, "/dashboard/trends?days=7&tz=Asia/Shanghai"))
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
	b := s.EnsureBaby(BabyParams{
		BirthDate:     "2026-07-15",
		BirthWeightKg: ptr(3.3),
		BirthHeightCm: ptr(50.0),
	})
	client := app.Client()
	sumURL := babyPath(b.ID, "/dashboard/summary?tz=Asia/Shanghai")

	initResp := client.Get(t, sumURL)
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
	midResp := client.Get(t, sumURL)
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

	afterResp := client.Get(t, sumURL)
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
 * Spec: dashboard-insights / Authenticated access to dashboard endpoints / Reject unauthenticated dashboard request; Reject dashboard request before baby onboarding; Reject dashboard request for foreign baby ID
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Reject invalid IANA timezone parameter
 * 测试场景：验证首页看板 summary 与 trends 端点的认证门禁（401）、未建档与跨用户越权隔离（404）及非法时区拒绝（400）。
 * 业务背景：看板聚合严格绑定归属宝宝与合法 IANA 时区，未登录、不存在或他人宝宝 ID 与非法时区均须在入口层明确拦截。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：用户 A（admin）、待强制改密用户 DashPending、普通用户 B（已完成改密）及匿名客户端
 * - 宝宝档案：步骤 1–2 用户 A 未建档；步骤 3 用户 A 建档后验证跨用户 404 与非法时区 400
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名请求 /api/babies/1/dashboard/summary 与 trends 均返回 401，待强制改密用户返回 403 PASSWORD_CHANGE_REQUIRED。
 * 2. 验证已登录但未拥有目标宝宝时请求两接口均返回 404。
 * 3. 验证建档后用户 B 访问用户 A 的宝宝看板返回 404，且携带非法 tz=Invalid/Zone 返回 400 中文错误。
 */
func TestDashboardAuthOnboardingAndTimezoneGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	clientA := app.Client()
	clientPending, _ := app.CreateUserViaAdmin("DashPending", "pending-init-secret-123")
	clientB, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	// 1. 未认证返回 401，待强制改密用户返回 403 PASSWORD_CHANGE_REQUIRED。
	anon.Get(t, babyPath(1, "/dashboard/summary")).RequireError(t, http.StatusUnauthorized, "")
	anon.Get(t, babyPath(1, "/dashboard/trends")).RequireError(t, http.StatusUnauthorized, "")
	for _, suffix := range []string{"/dashboard/summary", "/dashboard/trends"} {
		payload := DecodeStatus[struct {
			Code string `json:"code"`
		}](t, clientPending.Get(t, babyPath(1, suffix)), http.StatusForbidden)
		if payload.Code != "PASSWORD_CHANGE_REQUIRED" {
			t.Fatalf("待改密用户访问 %s 预期 PASSWORD_CHANGE_REQUIRED，实际 %+v", suffix, payload)
		}
	}

	// 2. 已认证但无对应归属宝宝返回 404。
	clientA.Get(t, babyPath(999, "/dashboard/summary")).RequireError(t, http.StatusNotFound, "")
	clientA.Get(t, babyPath(999, "/dashboard/trends")).RequireError(t, http.StatusNotFound, "")

	// 3. 建档后跨用户访问返回 404，且非法 IANA 时区参数返回 400 中文错误。
	b := app.ScenarioFor(clientA).EnsureBaby()
	clientB.Get(t, babyPath(b.ID, "/dashboard/summary")).RequireError(t, http.StatusNotFound, "")
	clientB.Get(t, babyPath(b.ID, "/dashboard/trends")).RequireError(t, http.StatusNotFound, "")

	clientA.Get(t, babyPath(b.ID, "/dashboard/summary?tz=Invalid/Zone")).RequireError(t, http.StatusBadRequest, "")
	clientA.Get(t, babyPath(b.ID, "/dashboard/trends?tz=Invalid/Zone")).RequireError(t, http.StatusBadRequest, "")
}
