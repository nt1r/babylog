package integration_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
)

/*
 * Spec: baby-profile / Baby profile retrieval and onboarding status / Retrieve empty profile before onboarding; Retrieve existing baby profile
 * Spec: baby-profile / Single baby profile creation / Create baby profile successfully
 * Spec: baby-profile / Baby profile update / Update existing baby profile
 * 测试场景：首次建档前探测空档案、完成单宝宝建档、回读核验、推进时钟更新档案并清空可选出生体格。
 * 业务背景：管理员首次登录后进入强制建档引导，建档完成后可在设置页修改昵称、出生日期及可选出生体重/身高（包括将误填的出生体格清空为 NULL）。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：初始未建档
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证未建档时 GET /api/baby 返回 200 {baby: null}，触发前端建档门禁。
 * 2. 验证首次 POST /api/baby 裁剪昵称空白并落库完整字段（201），随后 GET /api/baby 回读一致。
 * 3. 验证推进时钟后 PUT /api/baby 刷新 updated_at，且将出生体重/身高置空后 SQLite 真正落库为 NULL（而非被 GORM 零值跳过）。
 */
func TestBabyProfileOnboardingAndUpdateClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	client := app.Client()

	// 1. 建档前探测：确认返回 {baby: null}，作为首次引导建档的判定依据。
	emptyResp := client.Get(t, "/api/baby")
	emptyResp.RequireStatus(t, http.StatusOK)
	if got := DecodeOK[struct {
		Baby *baby.Profile `json:"baby"`
	}](t, emptyResp).Baby; got != nil {
		t.Fatalf("未建档时预期 baby=nil，实际 %+v", got)
	}

	// 2. 首次建档并回读：核对首尾空白昵称被裁剪、当天出生日合法放行，且回读接口返回完整档案。
	createResp := client.Post(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:      "  小汤圆  ",
		BirthDate:     "2026-11-23",
		Gender:        "female",
		BirthWeightKg: ptr(3.35),
		BirthHeightCm: ptr(50.2),
	})
	created := DecodeStatus[struct {
		Baby baby.Profile `json:"baby"`
	}](t, createResp, http.StatusCreated).Baby
	if created.ID <= 0 || created.Nickname != "小汤圆" || created.BirthDate != "2026-11-23" ||
		created.Gender != "female" || created.BirthWeightKg == nil || *created.BirthWeightKg != 3.35 ||
		created.BirthHeightCm == nil || *created.BirthHeightCm != 50.2 ||
		created.DefaultClinicName != "" || created.CreatedAt == "" || created.UpdatedAt == "" {
		t.Fatalf("建档返回档案字段异常：%+v", created)
	}

	getResp := client.Get(t, "/api/baby")
	getResp.RequireStatus(t, http.StatusOK)
	fetched := DecodeOK[struct {
		Baby *baby.Profile `json:"baby"`
	}](t, getResp).Baby
	if fetched == nil || fetched.ID != created.ID || fetched.Nickname != "小汤圆" {
		t.Fatalf("GET /api/baby 回读与建档结果不一致：%+v", fetched)
	}

	// 3. 推进时钟后更新档案并显式清空可选出生体格，回读 SQLite 验证 updated_at 递增且可空列真正清为 NULL。
	app.Clock.Advance(10 * time.Minute)
	updResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "大汤圆",
		BirthDate: "2026-07-15",
		Gender:    "female",
	})
	updResp.RequireStatus(t, http.StatusOK)
	updated := DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](t, updResp).Baby
	if updated.Nickname != "大汤圆" || updated.BirthDate != "2026-07-15" ||
		updated.BirthWeightKg != nil || updated.BirthHeightCm != nil ||
		updated.UpdatedAt <= created.UpdatedAt {
		t.Fatalf("更新档案返回异常（预期 updated_at > %q 且出生体格为空）：%+v", created.UpdatedAt, updated)
	}

	persisted := FirstRow[baby.Profile](t, app, "id = ?", created.ID)
	if persisted.Nickname != "大汤圆" || persisted.BirthWeightKg != nil || persisted.BirthHeightCm != nil ||
		persisted.UpdatedAt != updated.UpdatedAt {
		t.Fatalf("SQLite 落库档案未同步清空可空列或刷新时间戳：%+v", persisted)
	}
}

/*
 * Spec: baby-profile / Single baby profile creation / Create baby profile successfully; Reject invalid baby profile input
 * 测试场景：跨时区零点时刻按请求时区校验宝宝出生日期是否为未来日期。
 * 业务背景：服务端统一使用 UTC 存储，但新生儿在东八区凌晨出生时 UTC 尚处于前一日，必须按客户端传入的 ?tz= 判定“本地今天”。
 * 前置数据：
 * - 时钟与时区：固定在 2026-11-22 20:00:00Z（UTC 为 11-22，Asia/Shanghai 已进入 11-23 04:00）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：初始未建档
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证按 ?tz=UTC 提交 2026-11-23 出生日被判为未来日期返回 400 且 SQLite 零落库。
 * 2. 验证同一时刻按 ?tz=Asia/Shanghai 提交 2026-11-23（含省略出生体格）建档成功返回 201 且落库 1 条档案。
 */
func TestBabyProfileTimezoneTodayBirthDateBoundary(t *testing.T) {
	t.Parallel()

	// 2026-11-22 20:00Z：UTC 尚为 11-22，东八区已为 11-23 04:00。
	app := NewTestApp(t, WithClock(time.Date(2026, 11, 22, 20, 0, 0, 0, time.UTC)))
	client := app.Client()

	// 1. 按 UTC 校验时 2026-11-23 晚于当天，必须拒绝且不得产生脏档案。
	utcResp := client.Post(t, "/api/baby?tz=UTC", baby.UpsertInput{
		Nickname:  "时区宝",
		BirthDate: "2026-11-23",
		Gender:    "unknown",
	})
	utcResp.RequireError(t, http.StatusBadRequest, "不能晚于今天")
	if got := CountRows[baby.Profile](t, app, ""); got != 0 {
		t.Fatalf("UTC 未来日期拒绝后不应落库宝宝档案，实际 %d", got)
	}

	// 2. 按 Asia/Shanghai 校验时 2026-11-23 为本地今天，允许建档且无可选出生体格时正常落库 NULL。
	shResp := client.Post(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "时区宝",
		BirthDate: "2026-11-23",
		Gender:    "unknown",
	})
	shResp.RequireStatus(t, http.StatusCreated)
	persisted := FirstRow[baby.Profile](t, app, "")
	if persisted.BirthDate != "2026-11-23" || persisted.BirthWeightKg != nil || persisted.BirthHeightCm != nil {
		t.Fatalf("东八区当天建档落库结果异常：%+v", persisted)
	}
}

/*
 * Spec: baby-profile / Baby profile update / Preserve or update default_clinic_name on baby profile update
 * 测试场景：更新宝宝档案时验证 default_clinic_name 的三态指针契约与超长长度拦截。
 * 业务背景：设置页只改昵称时不传 default_clinic_name，绝不能把疫苗模块记住的常去接种门诊意外清空；仅显式传空串 "" 时才清空。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female，常去门诊为空）
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证传入带首尾空白的 default_clinic_name 被裁剪持久化。
 * 2. 验证省略 default_clinic_name 仅更新昵称时，既有常去门诊完整保留（接口与 SQLite 双重验证）。
 * 3. 验证超过 80 字的常去门诊返回 400 且不覆盖原值；显式传入 "" 清空并通过 GET /api/baby 与 SQLite 确认清空。
 */
func TestBabyProfileDefaultClinicTriStateUpdate(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	profile := app.Scenario().EnsureBaby()
	client := app.Client()

	// 1. 传入带首尾空白的常去门诊名称，核对裁剪落库。
	setResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:          profile.Nickname,
		BirthDate:         profile.BirthDate,
		Gender:            profile.Gender,
		DefaultClinicName: ptr("  阳光街道社区卫生服务中心  "),
	})
	setResp.RequireStatus(t, http.StatusOK)
	if got := DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](t, setResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("预期裁剪后的常去门诊为阳光街道社区卫生服务中心，实际 %q", got)
	}

	// 2. 省略 default_clinic_name 仅改昵称，验证 *string 三态“未传保留”语义不被零值覆盖。
	keepResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", map[string]any{
		"nickname":   "大汤圆",
		"birth_date": profile.BirthDate,
		"gender":     profile.Gender,
	})
	keepResp.RequireStatus(t, http.StatusOK)
	if got := DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](t, keepResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("省略 default_clinic_name 更新后预期保留原值，实际 %q", got)
	}
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("SQLite 中既有常去门诊被意外改写：%q", persisted.DefaultClinicName)
	}

	// 3. 超长（81 字）拦截保护既有值，随后显式传 "" 清空并经接口与 SQLite 双重回读核验。
	overResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:          "大汤圆",
		BirthDate:         profile.BirthDate,
		Gender:            profile.Gender,
		DefaultClinicName: ptr(strings.Repeat("医", baby.MaxClinicNameLength+1)),
	})
	overResp.RequireError(t, http.StatusBadRequest, "80")
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("400 校验失败后不应改动已落库常去门诊，实际 %q", persisted.DefaultClinicName)
	}

	client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:          "大汤圆",
		BirthDate:         profile.BirthDate,
		Gender:            profile.Gender,
		DefaultClinicName: ptr(""),
	}).RequireStatus(t, http.StatusOK)

	afterGet := client.Get(t, "/api/baby")
	afterGet.RequireStatus(t, http.StatusOK)
	afterBaby := DecodeOK[struct {
		Baby *baby.Profile `json:"baby"`
	}](t, afterGet).Baby
	if afterBaby == nil || afterBaby.DefaultClinicName != "" {
		t.Fatalf("显式清空后 GET /api/baby 预期返回空常去门诊，实际 %+v", afterBaby)
	}
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "" {
		t.Fatalf("SQLite 常去门诊未清空，实际 %q", persisted.DefaultClinicName)
	}
}

/*
 * Spec: baby-profile / Authenticated access to baby profile endpoints / Reject unauthenticated baby profile request
 * Spec: baby-profile / Single baby profile creation / Reject duplicate baby profile creation; Reject invalid baby profile input
 * Spec: baby-profile / Baby profile update / Reject update before onboarding
 * 测试场景：集中验证宝宝档案接口的认证门禁、未建档更新拒绝、非法入参拦截与单宝宝防重复建档。
 * 业务背景：BabyLog 为单宝宝模型，需同时守住未登录越权、未建档直调更新、非法字段写脏库及并发/重复 POST 创建第二份档案四条底线。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员，具备匿名与已登录两套客户端视图
 * - 宝宝档案：初始未建档（第 3 步先合法建档，再测重复建档 409）
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名访问 GET/POST/PUT /api/baby 均返回 401，未建档时 PUT /api/baby 返回 404。
 * 2. 验证空/超长昵称、畸形/未来日期、非法性别与越界出生体格均返回 400 且 SQLite 保持零行。
 * 3. 验证建档后再次 POST /api/baby 返回 409 且原档案不被修改、总数仍为 1。
 */
func TestBabyProfileAuthOnboardingValidationAndDuplicateGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	client := app.Client()

	// 1. 未认证访问一律 401；已认证但未建档直接 PUT 返回 404。
	anon.Get(t, "/api/baby").RequireError(t, http.StatusUnauthorized, "")
	anon.Post(t, "/api/baby", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}).
		RequireError(t, http.StatusUnauthorized, "")
	anon.Put(t, "/api/baby", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}).
		RequireError(t, http.StatusUnauthorized, "")

	client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "团子",
		BirthDate: "2026-07-15",
		Gender:    "male",
	}).RequireError(t, http.StatusNotFound, "")

	// 2. 集中校验各类非法建档载荷均返回 400 中文错误且数据库零脏行。
	invalidPayloads := []baby.UpsertInput{
		{Nickname: "   ", BirthDate: "2026-07-15", Gender: "male"},
		{Nickname: strings.Repeat("宝", baby.MaxNicknameLength+1), BirthDate: "2026-07-15", Gender: "male"},
		{Nickname: "小宝", BirthDate: "2026/07/15", Gender: "male"},
		{Nickname: "小宝", BirthDate: "2026-11-24", Gender: "male"},
		{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "other"},
		{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthWeightKg: ptr(20.0)},
		{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthHeightCm: ptr(120.0)},
	}
	for _, in := range invalidPayloads {
		client.Post(t, "/api/baby?tz=Asia/Shanghai", in).RequireError(t, http.StatusBadRequest, "")
	}
	if got := CountRows[baby.Profile](t, app, ""); got != 0 {
		t.Fatalf("非法建档载荷被拒后 SQLite 应保持 0 行，实际 %d", got)
	}

	// 3. 合法建档后再次 POST /api/baby 触发单宝宝唯一约束返回 409，且原档案完好无损。
	created := app.Scenario().EnsureBaby(BabyParams{Nickname: "原汤圆"})
	client.Post(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "二宝",
		BirthDate: "2026-08-01",
		Gender:    "male",
	}).RequireError(t, http.StatusConflict, "")

	if got := CountRows[baby.Profile](t, app, ""); got != 1 {
		t.Fatalf("重复建档拒绝后档案总数应仍为 1，实际 %d", got)
	}
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", created.ID); persisted.Nickname != "原汤圆" {
		t.Fatalf("重复建档拒绝后原档案被意外改写：%+v", persisted)
	}
}
