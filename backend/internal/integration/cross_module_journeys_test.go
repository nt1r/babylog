package integration_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

/*
 * Spec: admin-auth / Administrator login and session creation / Successful administrator login
 * Spec: baby-profile / Multi-baby profile creation / Create multiple baby profiles for the same user
 * Spec: daily-records / Smart defaults endpoint for low-friction entry / Compute smart defaults from recent history
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Compute today summary in specified timezone
 * Spec: vaccine-management / Dose status transitions and record updates / Auto-remember first non-birth clinic and respect explicit default clinic pin
 * 测试场景：模拟新手家长从首次登录、建档、首日多品类照护录入到看板趋势聚合与常规疫苗预约的完整跨模块闭环。
 * 业务背景：真实使用中认证、宝宝档案、日常记录、首页看板、智能默认值与疫苗管理并非孤立接口，而是同一套家庭照护工作流，必须验证端到端跨模块状态联动一致。
 * 前置数据：
 * - 时钟与时区：2026-11-23 16:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员（admin），从匿名状态开始登录
 * - 宝宝档案：初始未建档，步骤 1 建档（小汤圆、2026-07-15、female、出生 3.4kg / 50.5cm）
 * - 前置业务记录：无（步骤 2–3 经真实业务 API 逐步产生全天照护记录与疫苗预约）
 * 测试目标：
 * 1. 验证匿名管理员登录并建档后，首访疫苗概览触发 22 剂 NIP 懒初始化，首页看板自动以出生体格兜底。
 * 2. 验证录入跨夜整觉、配方奶、左侧亲喂、尿布、体温与用药后，首页 summary、7 日 trends 与智能默认值（换侧推荐右侧）全部同步联动。
 * 3. 验证预约常规疫苗自动记住常去门诊，且疫苗总览与宝宝列表跨端点同步回显该门诊。
 */
func TestNewParentFirstDayClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t, WithoutAutoLogin(), WithClock(time.Date(2026, 11, 23, 8, 0, 0, 0, time.UTC)))

	// 1. 匿名管理员登录并完成首次建档，模拟进入首页时同时拉取疫苗与看板冷启动视图。
	loginResp := app.UnauthenticatedClient().Login(t, defaultAdminUser, defaultAdminPass)
	loginResp.RequireStatus(t, http.StatusOK)
	cookiePair, ok := loginResp.CookiePair(auth.SessionCookieName)
	if !ok {
		t.Fatalf("登录响应缺少 %s 会话 Cookie", auth.SessionCookieName)
	}
	client := app.UnauthenticatedClient().WithCookie(cookiePair)
	s := &Scenario{t: t, client: client}

	profile := s.EnsureBaby(BabyParams{
		Nickname:      "小汤圆",
		BirthDate:     "2026-07-15",
		Gender:        "female",
		BirthWeightKg: ptr(3.4),
		BirthHeightCm: ptr(50.5),
	})
	ovInit := s.SeedVaccines("Asia/Shanghai")
	if len(ovInit.Doses) != 22 || !ovInit.Summary.BirthConfirmPending {
		t.Fatalf("首访疫苗初始化异常：doses=%d birthPending=%v", len(ovInit.Doses), ovInit.Summary.BirthConfirmPending)
	}
	sumInitResp := client.Get(t, babyPath(profile.ID, "/dashboard/summary?tz=Asia/Shanghai"))
	sumInitResp.RequireStatus(t, http.StatusOK)
	sumInit := DecodeOK[dashboard.SummaryResponse](t, sumInitResp)
	if sumInit.Growth.LatestWeightKg == nil || *sumInit.Growth.LatestWeightKg != 3.4 || !sumInit.Growth.WeightIsBirth {
		t.Fatalf("建档冷启动应回退出生体重 3.4kg：%+v", sumInit.Growth)
	}

	// 2. 家长录入首日完整照护活动，核对首页看板摘要、7 日趋势与智能默认值三处读模型实时联动一致。
	s.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 22:00→06:00+08（今日 360min）
	s.AddFormula(150, "2026-11-23T00:30:00Z")                                             // 08:30+08
	s.AddDirectBreast("left", 16, "2026-11-23T03:00:00Z")                                 // 11:00+08
	s.AddDiaper("poop", "soft", "yellow", "2026-11-23T04:00:00Z")                         // 12:00+08
	s.AddTemperature(36.8, "2026-11-23T05:00:00Z")                                        // 13:00+08
	s.AddMedicine("维生素 D3", "1 粒", "2026-11-23T05:30:00Z")                                // 13:30+08

	sumResp := client.Get(t, babyPath(profile.ID, "/dashboard/summary?tz=Asia/Shanghai"))
	sumResp.RequireStatus(t, http.StatusOK)
	sum := DecodeOK[dashboard.SummaryResponse](t, sumResp)
	if sum.Feeding.TotalML != 150 || sum.Feeding.DirectBreastMin != 16 || sum.Sleep.TotalMin != 360 ||
		sum.Care.PoopCount != 1 || sum.Health.LatestTempC == nil || *sum.Health.LatestTempC != 36.8 ||
		sum.Health.TodayMedicineCount != 1 {
		t.Fatalf("全天照护录入后首页摘要未同步联动：%+v", sum)
	}

	trendResp := client.Get(t, babyPath(profile.ID, "/dashboard/trends?days=7&tz=Asia/Shanghai"))
	trendResp.RequireStatus(t, http.StatusOK)
	tr := DecodeOK[dashboard.TrendsResponse](t, trendResp)
	if len(tr.Daily) != 7 {
		t.Fatalf("7 日趋势预期返回 7 个日桶，实际 %d", len(tr.Daily))
	}
	todayPoint := tr.Daily[len(tr.Daily)-1]
	if todayPoint.FeedingML != 150 || todayPoint.DirectBreastMin != 16 || todayPoint.SleepHours != 6.0 {
		t.Fatalf("趋势末日数据未与首页摘要对齐：%+v", todayPoint)
	}

	defResp := client.Get(t, babyPath(profile.ID, "/records/defaults"))
	defResp.RequireStatus(t, http.StatusOK)
	defs := DecodeOK[records.SmartDefaults](t, defResp)
	if defs.Feeding.LastMilkML != 150 || defs.Feeding.SuggestedBreastSide != "right" ||
		defs.Feeding.LastBreastDurationMin != 16 || defs.Health.LastTemperatureC != 36.8 {
		t.Fatalf("智能默认值未随首日记录联动更新：%+v", defs)
	}

	// 3. 预约 1 剂常规疫苗并填写社区门诊，验证自动记住常去门诊在疫苗总览与宝宝档案两端同步生效。
	hepb2 := findDoseViewByTemplate(ovInit.Doses, "hepb", 2)
	if hepb2 == nil {
		t.Fatalf("未找到常规乙肝第 2 剂")
	}
	s.UpdateVaccineDose(hepb2.ID, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: ptr("2026-11-28"),
		ScheduledTime: ptr("09:00"),
		ClinicName:    "枫林社区卫生服务中心",
	})
	if got := s.GetVaccinesOverview("Asia/Shanghai").DefaultClinicName; got != "枫林社区卫生服务中心" {
		t.Fatalf("疫苗总览未同步回显自动记住的常去门诊：%q", got)
	}
	babiesResp := client.Get(t, "/api/babies")
	babiesResp.RequireStatus(t, http.StatusOK)
	gotBabies := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, babiesResp).Babies
	if len(gotBabies) != 1 || gotBabies[0].ID != profile.ID || gotBabies[0].DefaultClinicName != "枫林社区卫生服务中心" {
		t.Fatalf("宝宝列表接口未同步反映疫苗预约记住的常去门诊：%+v", gotBabies)
	}
}

/*
 * Spec: daily-records / Feeding record CRUD and structured validation / Update and delete feeding record
 * Spec: daily-records / Smart defaults endpoint for low-friction entry / Compute smart defaults from recent history
 * Spec: dashboard-insights / Timezone-aware daily KPI summary and recency indicators / Independently resolve partial growth measurements and apply birth-profile fallback
 * 测试场景：误录数据编辑或删除后，首页看板健康观察、出生体格兜底与智能默认值换侧建议实时联动回退。
 * 业务背景：家长在夜间匆忙记录时常出现误录（如体温多输一位、多点一次亲喂、写错体重），编辑或删除该记录后，所有跨模块派生视图必须立刻回退到上一条有效事实或出生兜底值，不得残留过期状态。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：小汤圆（2026-07-15，female，出生 3.3kg / 50.0cm）
 * - 前置业务记录：2 条体温（36.6℃ 较早、38.9℃ 最新发烧）、2 条亲喂（左侧较早、右侧最新）、1 条唯一手工体重生长记录（7.5kg）
 * 测试目标：
 * 1. 验证将误录发烧 38.9℃ 修改为 36.9℃ 再删除后，首页健康观察 latest_temp_c 依次变为 36.9℃ 并回退至较早的 36.6℃。
 * 2. 验证删除最新的右侧亲喂后，智能默认值 last_breast_side 从 right 回退为 left、suggested_breast_side 从 left 切换为 right。
 * 3. 验证删除唯一一条手工体重记录后，首页生长概览自动回退至出生体重 3.3kg（weight_is_birth=true，日期等于出生日）。
 */
func TestRecordEditAndDeleteCrossModuleRollback(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby(BabyParams{
		BirthDate:     "2026-07-15",
		BirthWeightKg: ptr(3.3),
		BirthHeightCm: ptr(50.0),
	})
	client := app.Client()

	// 前置造数：准备“旧有效记录 + 新误录记录”的组合，确保删除新记录能观测到准确回退而非误读零值。
	s.AddTemperature(36.6, "2026-11-23T00:10:00Z")
	mistakenFever := s.AddTemperature(38.9, "2026-11-23T01:00:00Z")
	s.AddDirectBreast("left", 15, "2026-11-23T00:20:00Z")
	mistakenRight := s.AddDirectBreast("right", 10, "2026-11-23T01:10:00Z")
	onlyWeight := s.AddGrowth(GrowthParams{WeightKg: ptr(7.5), RecordedAt: "2026-11-23T01:20:00Z"})

	fetchSummary := func() dashboard.SummaryResponse {
		t.Helper()
		resp := client.Get(t, babyPath(b.ID, "/dashboard/summary?tz=Asia/Shanghai"))
		resp.RequireStatus(t, http.StatusOK)
		return DecodeOK[dashboard.SummaryResponse](t, resp)
	}

	// 1. 先编辑误录发烧为 36.9℃ 核对看板更新，再彻底删除该记录核对看板回退至上一条 36.6℃。
	client.Put(t, babyPath(b.ID, fmt.Sprintf("/records/health/%d", mistakenFever.ID)), records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: ptr(36.9),
		RecordedAt:   "2026-11-23T01:00:00Z",
	}).RequireStatus(t, http.StatusOK)
	if sum := fetchSummary(); sum.Health.LatestTempC == nil || *sum.Health.LatestTempC != 36.9 {
		t.Fatalf("修改体温后看板应显示 36.9℃，实际 %+v", sum.Health)
	}
	client.Delete(t, babyPath(b.ID, fmt.Sprintf("/records/health/%d", mistakenFever.ID))).RequireStatus(t, http.StatusOK)
	if sum := fetchSummary(); sum.Health.LatestTempC == nil || *sum.Health.LatestTempC != 36.6 {
		t.Fatalf("删除最新体温后看板应回退至 36.6℃，实际 %+v", sum.Health)
	}

	// 2. 删除最新右侧亲喂前先确认当前推荐左侧，删除后确认智能默认值立即回退为上次左侧、推荐右侧。
	defBeforeResp := client.Get(t, babyPath(b.ID, "/records/defaults"))
	defBeforeResp.RequireStatus(t, http.StatusOK)
	defBefore := DecodeOK[records.SmartDefaults](t, defBeforeResp)
	if defBefore.Feeding.SuggestedBreastSide != "left" {
		t.Fatalf("删除前最新为右侧亲喂，预期推荐 left，实际 %q", defBefore.Feeding.SuggestedBreastSide)
	}
	client.Delete(t, babyPath(b.ID, fmt.Sprintf("/records/feeding/%d", mistakenRight.ID))).RequireStatus(t, http.StatusOK)
	defAfterResp := client.Get(t, babyPath(b.ID, "/records/defaults"))
	defAfterResp.RequireStatus(t, http.StatusOK)
	defAfter := DecodeOK[records.SmartDefaults](t, defAfterResp)
	if defAfter.Feeding.LastBreastSide == nil || *defAfter.Feeding.LastBreastSide != "left" ||
		defAfter.Feeding.SuggestedBreastSide != "right" {
		t.Fatalf("删除右侧亲喂后应回退至左侧并推荐 right，实际 %+v", defAfter.Feeding)
	}

	// 3. 删除唯一手工体重记录后，首页生长概览应无缝回退出生体重 3.3kg 并恢复 weight_is_birth=true。
	if sum := fetchSummary(); sum.Growth.LatestWeightKg == nil || *sum.Growth.LatestWeightKg != 7.5 || sum.Growth.WeightIsBirth {
		t.Fatalf("删除前应显示手工体重 7.5kg：%+v", sum.Growth)
	}
	client.Delete(t, babyPath(b.ID, fmt.Sprintf("/records/health/%d", onlyWeight.ID))).RequireStatus(t, http.StatusOK)
	sumFallback := fetchSummary()
	if sumFallback.Growth.LatestWeightKg == nil || *sumFallback.Growth.LatestWeightKg != 3.3 ||
		!sumFallback.Growth.WeightIsBirth || sumFallback.Growth.WeightRecordedAt == nil ||
		*sumFallback.Growth.WeightRecordedAt != "2026-07-15" {
		t.Fatalf("删除唯一手工体重后应回退出生基准 3.3kg(2026-07-15)，实际 %+v", sumFallback.Growth)
	}
}

/*
 * Spec: baby-profile / Baby profile update / Update existing baby profile
 * Spec: vaccine-management / Idempotent NIP schedule initialization and overview retrieval / Compute effective due dates with month-end clamping
 * 测试场景：宝宝建档填错出生日期，经设置更新正确出生日期后，疫苗计划按新出生日实时联动重算并保护手工日期与已完成记录。
 * 业务背景：疫苗的 default_due_date、effective_date 与提醒状态均以宝宝档案的 birth_date 实时推导，家长在设置页修正出生日期后，未定制排期的待接种剂次必须立即重算，已手填 planned_date 与已接种剂次则保持原记录不变。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：初始误填出生日期 2026-08-31（female），步骤 2 更正为 2026-10-31
 * - 前置业务记录：已初始化 22 剂 NIP，其中乙肝第 1 剂已标记接种（2026-11-01），脊灰第 1 剂手工指定 planned_date=2026-12-20，乙肝第 2 剂保持默认待接种
 * 测试目标：
 * 1. 验证初始出生日 2026-08-31 下，1 月龄乙肝第 2 剂默认日期为 2026-09-30 且因距今超 14 天处于 overdue 态。
 * 2. 验证经 PUT /api/babies/:babyId 将出生日更正为 2026-10-31 后，再次 GET /api/babies/:babyId/vaccines 时乙肝第 2 剂自动重算并钳位为 2026-11-30（转为 due_soon），而已定制 planned_date 的脊灰第 1 剂与已完成的乙肝第 1 剂保持原生效日期不变。
 */
func TestBabyBirthDateCorrectionRecalculatesVaccines(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	profile := s.EnsureBaby(BabyParams{
		Nickname:  "小汤圆",
		BirthDate: "2026-08-31",
		Gender:    "female",
	})
	ovBefore := s.SeedVaccines("Asia/Shanghai")

	// 前置造数：完成乙肝第 1 剂，并为脊灰第 1 剂设置手工 planned_date，用于核对更正出生日后不被误改。
	hepb1 := findDoseViewByTemplate(ovBefore.Doses, "hepb", 1)
	hepb2Before := findDoseViewByTemplate(ovBefore.Doses, "hepb", 2)
	polio1 := findDoseViewByTemplate(ovBefore.Doses, "polio", 1)
	if hepb1 == nil || hepb2Before == nil || polio1 == nil {
		t.Fatalf("缺少内置 NIP 剂次")
	}
	s.UpdateVaccineDose(hepb1.ID, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: ptr("2026-11-01"),
	})
	s.UpdateVaccineDose(polio1.ID, vaccines.UpdateDoseInput{
		Status:      vaccines.StatusPending,
		PlannedDate: ptr("2026-12-20"),
	})

	// 1. 核对旧出生日（2026-08-31）下 1 月龄乙肝第 2 剂钳位为 2026-09-30 且处于 overdue 态。
	if hepb2Before.DefaultDueDate != "2026-09-30" || hepb2Before.EffectiveDate != "2026-09-30" ||
		hepb2Before.AlertState != vaccines.AlertOverdue {
		t.Fatalf("旧出生日下乙肝第 2 剂预期 2026-09-30/overdue，实际 %+v", hepb2Before)
	}

	// 2. 更正宝宝出生日期为 2026-10-31，核对默认待接种剂次重算并钳位至 2026-11-30(due_soon)，而手工 planned_date 与已接种记录保持不变。
	s.UpdateBaby(baby.UpsertInput{
		Nickname:  profile.Nickname,
		BirthDate: "2026-10-31",
		Gender:    profile.Gender,
	})

	ovAfter := s.GetVaccinesOverview("Asia/Shanghai")
	if ovAfter.BirthDate != "2026-10-31" {
		t.Fatalf("疫苗总览未同步新出生日期：%+v", ovAfter.BirthDate)
	}
	hepb2After := findDoseViewByTemplate(ovAfter.Doses, "hepb", 2)
	polio1After := findDoseViewByTemplate(ovAfter.Doses, "polio", 1)
	hepb1After := findDoseViewByTemplate(ovAfter.Doses, "hepb", 1)
	if hepb2After == nil || hepb2After.DefaultDueDate != "2026-11-30" ||
		hepb2After.EffectiveDate != "2026-11-30" || hepb2After.AlertState != vaccines.AlertDueSoon {
		t.Fatalf("更正出生日后乙肝第 2 剂预期重算为 2026-11-30/due_soon，实际 %+v", hepb2After)
	}
	if polio1After == nil || polio1After.DefaultDueDate != "2026-12-31" || polio1After.EffectiveDate != "2026-12-20" {
		t.Fatalf("手工指定 planned_date 的脊灰第 1 剂应保留生效日期 2026-12-20，实际 %+v", polio1After)
	}
	if hepb1After == nil || hepb1After.Status != vaccines.StatusCompleted || hepb1After.EffectiveDate != "2026-11-01" {
		t.Fatalf("已接种的乙肝第 1 剂应保持原接种日期 2026-11-01，实际 %+v", hepb1After)
	}
}

/*
 * Spec: user-management / Admin web user management API / Administrator creates, resets password, and disables an ordinary user via API
 * Spec: baby-profile / Hard deletion of a baby profile / Hard-delete an owned baby profile and cascade child records
 * Spec: daily-records / Authenticated access and baby-profile precondition for records / Reject record access for foreign baby ID
 * Spec: dashboard-insights / Authenticated access to dashboard endpoints / Reject dashboard request for foreign baby ID
 * Spec: vaccine-management / Authenticated access to vaccine endpoints / Reject vaccine request for foreign baby ID
 * 测试场景：多用户多宝宝全链路闭环——管理员代建两户家庭账号、各自改密建娃记录、双层越权全拒、单娃硬删除不误伤兄弟与他户、管理员停用即时踢出。
 * 业务背景：验证多用户与多宝宝引入后，从账号开通、强制改密、跨宝宝日常照护、越权探测到删除宝宝和停用账号整条链路数据零泄漏、零误伤。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：唯一管理员已登录（本身无宝宝），依次创建家庭 A 与家庭 B
 * - 宝宝档案：家庭 A 建大宝与二宝；家庭 B 建三宝
 * - 前置业务记录：各宝宝写入差异化喂养与疫苗数据
 * 测试目标：
 * 1. 验证无宝宝的管理员可直接开号，家庭 A 与家庭 B 完成首次改密并各自建娃记录后，首页看板、智能默认值与疫苗总览严格隔离。
 * 2. 验证管理员与家庭 B 均无法访问家庭 A 的宝宝记录/看板/疫苗（全部 404），贯彻运维权限与业务隐私分离原则。
 * 3. 验证家庭 A 硬删除大宝后大宝数据级联清零而二宝与家庭 B 完好，随后管理员停用家庭 B 立即踢出其会话且不影响家庭 A。
 */
func TestMultiUserMultiBabyFullIsolationJourney(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	adminClient := app.Client()

	// 1. 管理员代建家庭 A、家庭 B，两户各自完成首次改密并建娃录入差异化数据，验证读模型严格隔离。
	clientA, _ := app.CreateReadyUserViaAdmin("FamilyA", "familya-init-1234", "familya-priv-5678")
	clientB, userB := app.CreateReadyUserViaAdmin("FamilyB", "familyb-init-1234", "familyb-priv-5678")

	sA := app.ScenarioFor(clientA)
	a1 := sA.EnsureBaby(BabyParams{Nickname: "A大宝"})
	sA.ForBaby(a1.ID).AddFormula(180, "2026-11-23T01:00:00Z")
	sA.ForBaby(a1.ID).SeedVaccines()

	a2 := sA.EnsureBaby(BabyParams{Nickname: "A二宝"})
	sA.ForBaby(a2.ID).AddFormula(90, "2026-11-23T01:10:00Z")

	sB := app.ScenarioFor(clientB)
	b1 := sB.EnsureBaby(BabyParams{Nickname: "B宝宝"})
	sB.ForBaby(b1.ID).AddFormula(150, "2026-11-23T01:20:00Z")

	sumA1 := DecodeOK[dashboard.SummaryResponse](t, clientA.Get(t, babyPath(a1.ID, "/dashboard/summary?tz=Asia/Shanghai")))
	sumA2 := DecodeOK[dashboard.SummaryResponse](t, clientA.Get(t, babyPath(a2.ID, "/dashboard/summary?tz=Asia/Shanghai")))
	sumB1 := DecodeOK[dashboard.SummaryResponse](t, clientB.Get(t, babyPath(b1.ID, "/dashboard/summary?tz=Asia/Shanghai")))
	if sumA1.Feeding.TotalML != 180 || sumA2.Feeding.TotalML != 90 || sumB1.Feeding.TotalML != 150 {
		t.Fatalf("多用户多宝宝看板汇总出现串扰：a1=%d a2=%d b1=%d",
			sumA1.Feeding.TotalML, sumA2.Feeding.TotalML, sumB1.Feeding.TotalML)
	}

	// 2. 唯一管理员与家庭 B 访问家庭 A 的宝宝记录/看板/疫苗全部返回 404（管理员同样严守隐私边界）。
	for _, intruder := range []*AppClient{adminClient, clientB} {
		intruder.Get(t, babyPath(a1.ID, "/records/feeding")).RequireError(t, http.StatusNotFound, "")
		intruder.Get(t, babyPath(a1.ID, "/dashboard/summary")).RequireError(t, http.StatusNotFound, "")
		intruder.Get(t, babyPath(a1.ID, "/vaccines")).RequireError(t, http.StatusNotFound, "")
	}

	// 3. 家庭 A 硬删除大宝仅清理大宝级联数据；管理员停用家庭 B 立即踢出 B 会话且不影响家庭 A 继续使用。
	clientA.Delete(t, fmt.Sprintf("/api/babies/%d", a1.ID)).RequireStatus(t, http.StatusOK)
	if CountRows[records.FeedingRecord](t, app, "baby_id = ?", a1.ID) != 0 ||
		CountRows[vaccines.DoseRecord](t, app, "baby_id = ?", a1.ID) != 0 {
		t.Fatalf("删除 A 大宝后子表记录未完全级联清零")
	}
	if CountRows[records.FeedingRecord](t, app, "baby_id = ?", a2.ID) != 1 ||
		CountRows[records.FeedingRecord](t, app, "baby_id = ?", b1.ID) != 1 {
		t.Fatalf("删除 A 大宝不应影响 A 二宝与 B 宝宝")
	}

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", userB.ID), map[string]bool{"disabled": true}).
		RequireStatus(t, http.StatusOK)
	clientB.Get(t, "/api/babies").RequireError(t, http.StatusUnauthorized, "登录")
	clientA.Get(t, babyPath(a2.ID, "/dashboard/summary?tz=Asia/Shanghai")).RequireStatus(t, http.StatusOK)
}
