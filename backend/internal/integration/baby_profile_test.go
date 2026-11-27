package integration_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

/*
 * Spec: baby-profile / Baby profile retrieval and onboarding status / Retrieve empty profile before onboarding; Retrieve existing baby profile
 * Spec: baby-profile / Multi-baby profile creation / Create multiple baby profiles for the same user
 * Spec: baby-profile / Baby profile update / Update existing baby profile
 * 测试场景：首次建档前探测空列表、同一用户创建多个宝宝（含同名）、跨用户列表隔离与推进时钟更新指定宝宝并清空可选出生体格。
 * 业务背景：一户一账号支持二胎或双胞胎多宝宝建档，且不同家庭账号之间的宝宝列表必须完全隔离互不可见。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：管理员（用户 A）与普通用户 B（已完成改密）均已登录
 * - 宝宝档案：初始均未建档
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证未建档时 GET /api/babies 返回 200 {babies: []}；用户 A 建档两个宝宝后，用户 B 仍探测到空列表。
 * 2. 验证用户 A 列表仅返回自身两个按 id ASC 排序的宝宝档案且昵称裁剪正确。
 * 3. 验证推进时钟后 PUT /api/babies/:babyId 刷新 updated_at 并真正将清空的出生体重/身高落库为 NULL。
 */
func TestBabyProfileOnboardingAndUpdateClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	clientA := app.Client()
	clientB, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	// 1. 建档前探测空列表；用户 A 创建两个宝宝（允许同名）后，用户 B 依然看到空列表。
	emptyA := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, clientA.Get(t, "/api/babies")).Babies
	if len(emptyA) != 0 {
		t.Fatalf("未建档时预期 babies 为空数组，实际 %+v", emptyA)
	}

	firstResp := clientA.Post(t, "/api/babies?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:      "  小汤圆  ",
		BirthDate:     "2026-11-23",
		Gender:        "female",
		BirthWeightKg: ptr(3.35),
		BirthHeightCm: ptr(50.2),
	})
	first := DecodeStatus[struct {
		Baby baby.Profile `json:"baby"`
	}](t, firstResp, http.StatusCreated).Baby
	if first.ID <= 0 || first.Nickname != "小汤圆" || first.BirthDate != "2026-11-23" ||
		first.Gender != "female" || first.BirthWeightKg == nil || *first.BirthWeightKg != 3.35 ||
		first.BirthHeightCm == nil || *first.BirthHeightCm != 50.2 || first.DefaultClinicName != "" {
		t.Fatalf("首次建档返回档案字段异常：%+v", first)
	}

	secondResp := clientA.Post(t, "/api/babies?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "小汤圆",
		BirthDate: "2026-08-01",
		Gender:    "male",
	})
	second := DecodeStatus[struct {
		Baby baby.Profile `json:"baby"`
	}](t, secondResp, http.StatusCreated).Baby
	if second.ID <= first.ID || second.Nickname != "小汤圆" {
		t.Fatalf("同用户第二个宝宝（同名）建档返回异常：%+v", second)
	}

	emptyB := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, clientB.Get(t, "/api/babies")).Babies
	if len(emptyB) != 0 {
		t.Fatalf("用户 A 建档后用户 B 仍应为空列表，实际 %+v", emptyB)
	}

	// 2. 用户 B 建档后，用户 A 的 GET /api/babies 仅返回 A 的 2 个宝宝并按 id ASC 排序。
	app.ScenarioFor(clientB).EnsureBaby(BabyParams{Nickname: "B家宝宝"})
	listA := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, clientA.Get(t, "/api/babies")).Babies
	if len(listA) != 2 || listA[0].ID != first.ID || listA[1].ID != second.ID {
		t.Fatalf("用户 A 回读宝宝列表应严格隔离且按 id ASC 排序，实际 %+v", listA)
	}

	// 3. 推进时钟后更新首个宝宝并显式清空可选出生体格，回读 SQLite 确认真正清为 NULL。
	app.Clock.Advance(10 * time.Minute)
	updResp := clientA.Put(t, fmt.Sprintf("/api/babies/%d?tz=Asia/Shanghai", first.ID), baby.UpsertInput{
		Nickname:  "大汤圆",
		BirthDate: "2026-07-15",
		Gender:    "female",
	})
	updated := DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](t, updResp).Baby
	if updated.Nickname != "大汤圆" || updated.BirthDate != "2026-07-15" ||
		updated.BirthWeightKg != nil || updated.BirthHeightCm != nil ||
		updated.UpdatedAt <= first.UpdatedAt {
		t.Fatalf("更新宝宝档案返回异常：%+v", updated)
	}

	persisted := FirstRow[baby.Profile](t, app, "id = ?", first.ID)
	if persisted.Nickname != "大汤圆" || persisted.BirthWeightKg != nil || persisted.BirthHeightCm != nil ||
		persisted.UpdatedAt != updated.UpdatedAt {
		t.Fatalf("SQLite 落库档案未同步清空可空列或刷新时间戳：%+v", persisted)
	}
}

/*
 * Spec: baby-profile / Multi-baby profile creation / Create multiple baby profiles for the same user; Reject invalid baby profile input
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

	app := NewTestApp(t, WithClock(time.Date(2026, 11, 22, 20, 0, 0, 0, time.UTC)))
	client := app.Client()

	// 1. 按 UTC 校验时 2026-11-23 晚于当天，必须拒绝且不得产生脏档案。
	utcResp := client.Post(t, "/api/babies?tz=UTC", baby.UpsertInput{
		Nickname:  "时区宝",
		BirthDate: "2026-11-23",
		Gender:    "unknown",
	})
	utcResp.RequireError(t, http.StatusBadRequest, "不能晚于今天")
	if got := CountRows[baby.Profile](t, app, ""); got != 0 {
		t.Fatalf("UTC 未来日期拒绝后不应落库宝宝档案，实际 %d", got)
	}

	// 2. 按 Asia/Shanghai 校验时 2026-11-23 为本地今天，允许建档且无可选出生体格时正常落库 NULL。
	shResp := client.Post(t, "/api/babies?tz=Asia/Shanghai", baby.UpsertInput{
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
 * 3. 验证超过 80 字的常去门诊返回 400 且不覆盖原值；显式传入 "" 清空并通过 GET /api/babies 与 SQLite 确认清空。
 */
func TestBabyProfileDefaultClinicTriStateUpdate(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	profile := app.Scenario().EnsureBaby()
	client := app.Client()
	putURL := fmt.Sprintf("/api/babies/%d?tz=Asia/Shanghai", profile.ID)

	// 1. 传入带首尾空白的常去门诊名称，核对裁剪落库。
	setResp := client.Put(t, putURL, baby.UpsertInput{
		Nickname:          profile.Nickname,
		BirthDate:         profile.BirthDate,
		Gender:            profile.Gender,
		DefaultClinicName: ptr("  阳光街道社区卫生服务中心  "),
	})
	if got := DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](t, setResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("预期裁剪后的常去门诊为阳光街道社区卫生服务中心，实际 %q", got)
	}

	// 2. 省略 default_clinic_name 仅改昵称，验证 *string 三态“未传保留”语义不被零值覆盖。
	keepResp := client.Put(t, putURL, map[string]any{
		"nickname":   "大汤圆",
		"birth_date": profile.BirthDate,
		"gender":     profile.Gender,
	})
	if got := DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](t, keepResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
		t.Fatalf("省略 default_clinic_name 更新后预期保留原值，实际 %q", got)
	}
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("SQLite 中既有常去门诊被意外改写：%q", persisted.DefaultClinicName)
	}

	// 3. 超长（81 字）拦截保护既有值，随后显式传 "" 清空并经接口与 SQLite 双重回读核验。
	client.Put(t, putURL, baby.UpsertInput{
		Nickname:          "大汤圆",
		BirthDate:         profile.BirthDate,
		Gender:            profile.Gender,
		DefaultClinicName: ptr(strings.Repeat("医", baby.MaxClinicNameLength+1)),
	}).RequireError(t, http.StatusBadRequest, "80")
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("400 校验失败后不应改动已落库常去门诊，实际 %q", persisted.DefaultClinicName)
	}

	client.Put(t, putURL, baby.UpsertInput{
		Nickname:          "大汤圆",
		BirthDate:         profile.BirthDate,
		Gender:            profile.Gender,
		DefaultClinicName: ptr(""),
	}).RequireStatus(t, http.StatusOK)

	afterBabies := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, client.Get(t, "/api/babies")).Babies
	if len(afterBabies) != 1 || afterBabies[0].DefaultClinicName != "" {
		t.Fatalf("显式清空后 GET /api/babies 预期返回空常去门诊，实际 %+v", afterBabies)
	}
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "" {
		t.Fatalf("SQLite 常去门诊未清空，实际 %q", persisted.DefaultClinicName)
	}
}

/*
 * Spec: baby-profile / Hard deletion of a baby profile / Hard-delete an owned baby profile and cascade child records; Reject deleting another user's baby profile
 * Spec: baby-profile / Baby profile update / Reject updating another user's baby profile
 * 测试场景：验证硬删除宝宝档案级联清空全部 5 张子表并释放额度，同时拒绝跨用户修改或删除他人宝宝档案（404）。
 * 业务背景：删除宝宝必须物理清除所有关联隐私记录且绝不能影响兄弟宝宝或其他用户的数据，越权操作统一返回 404 防枚举。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：用户 A（admin）与普通用户 B（已完成改密）
 * - 宝宝档案：用户 A 拥有大宝与二宝；用户 B 拥有三宝
 * - 前置业务记录：大宝名下写入喂养、睡眠、护理、健康与疫苗记录；二宝名下写入 1 条喂养记录
 * 测试目标：
 * 1. 验证普通用户 B 越权 PUT/DELETE 管理员的大宝，以及管理员反向越权 PUT/DELETE 用户 B 的三宝均返回 404，双方原数据完好无损。
 * 2. 验证用户 A 硬删除大宝后 5 张子表级联清零且二宝/三宝不受影响，继续删除最后一个宝宝（二宝）后 GET /api/babies 返回空数组 []。
 */
func TestBabyProfileHardDeleteCascadeAndCrossUserGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	clientA := app.Client()
	clientB, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	sA := app.ScenarioFor(clientA)
	babyA1 := sA.EnsureBaby(BabyParams{Nickname: "大宝"})
	sA.AddFormula(120, "2026-11-23T01:00:00Z")
	sA.AddSleep(records.SleepSubtypeNap, "2026-11-23T01:00:00Z", "2026-11-23T01:45:00Z")
	sA.AddBath("2026-11-23T01:30:00Z")
	sA.AddTemperature(36.7, "2026-11-23T01:40:00Z")
	sA.SeedVaccines()

	babyA2 := sA.EnsureBaby(BabyParams{Nickname: "二宝"})
	sA.ForBaby(babyA2.ID).AddFormula(90, "2026-11-23T01:20:00Z")

	sB := app.ScenarioFor(clientB)
	babyB := sB.EnsureBaby(BabyParams{Nickname: "三宝"})
	sB.ForBaby(babyB.ID).AddFormula(150, "2026-11-23T01:30:00Z")

	// 1. 双向跨用户 PUT/DELETE（含管理员访问普通用户宝宝）均返回 404 且原数据毫发无损。
	clientB.Put(t, fmt.Sprintf("/api/babies/%d?tz=Asia/Shanghai", babyA1.ID), baby.UpsertInput{
		Nickname:  "篡改",
		BirthDate: "2026-07-15",
		Gender:    "male",
	}).RequireError(t, http.StatusNotFound, "")
	clientB.Delete(t, fmt.Sprintf("/api/babies/%d", babyA1.ID)).
		RequireError(t, http.StatusNotFound, "")
	clientA.Put(t, fmt.Sprintf("/api/babies/%d?tz=Asia/Shanghai", babyB.ID), baby.UpsertInput{
		Nickname:  "管理员篡改",
		BirthDate: "2026-07-15",
		Gender:    "male",
	}).RequireError(t, http.StatusNotFound, "")
	clientA.Delete(t, fmt.Sprintf("/api/babies/%d", babyB.ID)).
		RequireError(t, http.StatusNotFound, "")
	if persisted := FirstRow[baby.Profile](t, app, "id = ?", babyA1.ID); persisted.Nickname != "大宝" {
		t.Fatalf("跨用户越权拒绝后大宝档案被意外修改：%+v", persisted)
	}
	if persistedB := FirstRow[baby.Profile](t, app, "id = ?", babyB.ID); persistedB.Nickname != "三宝" {
		t.Fatalf("管理员越权拒绝后用户 B 的三宝档案被意外修改：%+v", persistedB)
	}

	// 2. 用户 A 硬删除大宝后 5 张子表级联清零且二宝/三宝完好；继续删除最后一个宝宝二宝后列表归空。
	delResp := clientA.Delete(t, fmt.Sprintf("/api/babies/%d", babyA1.ID))
	if !DecodeOK[struct {
		Deleted bool `json:"deleted"`
	}](t, delResp).Deleted {
		t.Fatalf("硬删除大宝预期返回 deleted=true")
	}
	if CountRows[baby.Profile](t, app, "id = ?", babyA1.ID) != 0 ||
		CountRows[records.FeedingRecord](t, app, "baby_id = ?", babyA1.ID) != 0 ||
		CountRows[records.SleepRecord](t, app, "baby_id = ?", babyA1.ID) != 0 ||
		CountRows[records.CareRecord](t, app, "baby_id = ?", babyA1.ID) != 0 ||
		CountRows[records.HealthRecord](t, app, "baby_id = ?", babyA1.ID) != 0 ||
		CountRows[vaccines.DoseRecord](t, app, "baby_id = ?", babyA1.ID) != 0 {
		t.Fatalf("硬删除大宝后 5 张关联子表未完全级联清零")
	}
	if CountRows[records.FeedingRecord](t, app, "baby_id = ?", babyA2.ID) != 1 ||
		CountRows[records.FeedingRecord](t, app, "baby_id = ?", babyB.ID) != 1 {
		t.Fatalf("删除大宝不应误伤二宝或用户 B 的宝宝记录")
	}

	clientA.Delete(t, fmt.Sprintf("/api/babies/%d", babyA2.ID)).RequireStatus(t, http.StatusOK)
	remainingA := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, clientA.Get(t, "/api/babies")).Babies
	if len(remainingA) != 0 || CountRows[records.FeedingRecord](t, app, "baby_id = ?", babyA2.ID) != 0 {
		t.Fatalf("删除最后一个宝宝后列表应为空且二宝记录级联清零，实际 remaining=%+v", remainingA)
	}
	if CountRows[records.FeedingRecord](t, app, "baby_id = ?", babyB.ID) != 1 {
		t.Fatalf("删除用户 A 全部宝宝不应影响用户 B 的宝宝记录")
	}
}

/*
 * Spec: baby-profile / Authenticated access to baby profile endpoints / Reject unauthenticated baby profile request
 * Spec: baby-profile / Multi-baby profile creation / Enforce maximum of 10 baby profiles per user; Reject invalid baby profile input
 * Spec: baby-profile / Baby profile update / Reject update before onboarding
 * 测试场景：集中验证宝宝档案接口的认证与待改密门禁（401/403）、空档案更新 404、非法路径参数/时区/入参 400 与每用户 10 个宝宝上限且用户间额度独立。
 * 业务背景：多宝宝场景需守住未登录与待改密拦截、非法数据零脏写与单用户合理数量配额，同时确保 A 满额不影响 B 建档，且删除后释放配额。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：管理员（用户 A）、普通用户 B（已完成改密）、待强制改密用户 P 及匿名客户端
 * - 宝宝档案：初始未建档
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名访问 GET/POST/PUT/DELETE /api/babies* 均返回 401，待改密用户返回 403 PASSWORD_CHANGE_REQUIRED，未建档时 PUT /api/babies/999 返回 404。
 * 2. 验证非法昵称、日期、性别、出生体格、非法路径 :babyId 与非法时区全部返回 400 且零落库。
 * 3. 验证用户 A 建满 10 个宝宝后第 11 个返回 400，用户 B 仍可正常建档，且 A 删除 1 个宝宝后额度恢复可再建。
 */
func TestBabyProfileAuthOnboardingValidationAndLimitGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	clientA := app.Client()
	clientPending, _ := app.CreateUserViaAdmin("BabyPending", "pending-init-secret-123")
	clientB, _ := app.CreateReadyUserViaAdmin("UserB", "userb-init-secret-123", "userb-final-secret-456")

	// 1. 未认证访问一律 401；待强制改密用户写/读接口一律 403 PASSWORD_CHANGE_REQUIRED；不存在或未建档直接 PUT 返回 404。
	anon.Get(t, "/api/babies").RequireError(t, http.StatusUnauthorized, "")
	anon.Post(t, "/api/babies", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}).
		RequireError(t, http.StatusUnauthorized, "")
	anon.Put(t, "/api/babies/1", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}).
		RequireError(t, http.StatusUnauthorized, "")
	anon.Delete(t, "/api/babies/1").RequireError(t, http.StatusUnauthorized, "")

	for _, resp := range []*Response{
		clientPending.Get(t, "/api/babies"),
		clientPending.Post(t, "/api/babies", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}),
		clientPending.Put(t, "/api/babies/1", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}),
		clientPending.Delete(t, "/api/babies/1"),
	} {
		payload := DecodeStatus[struct {
			Code string `json:"code"`
		}](t, resp, http.StatusForbidden)
		if payload.Code != "PASSWORD_CHANGE_REQUIRED" {
			t.Fatalf("待改密用户访问 %s %s 预期 PASSWORD_CHANGE_REQUIRED，实际 %+v", resp.Method, resp.Path, payload)
		}
	}

	clientA.Put(t, "/api/babies/999?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "团子",
		BirthDate: "2026-07-15",
		Gender:    "male",
	}).RequireError(t, http.StatusNotFound, "")

	// 2. 集中校验各类非法建档载荷、非法路径编号与非法时区均返回 400 中文错误且数据库零脏行。
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
		clientA.Post(t, "/api/babies?tz=Asia/Shanghai", in).RequireError(t, http.StatusBadRequest, "")
	}
	clientA.Post(t, "/api/babies?tz=Invalid/Zone", baby.UpsertInput{
		Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male",
	}).RequireError(t, http.StatusBadRequest, "时区")
	clientA.Put(t, "/api/babies/abc?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male",
	}).RequireError(t, http.StatusBadRequest, "编号")
	clientA.Put(t, "/api/babies/1?tz=Invalid/Zone", baby.UpsertInput{
		Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male",
	}).RequireError(t, http.StatusBadRequest, "时区")
	clientA.Delete(t, "/api/babies/0").RequireError(t, http.StatusBadRequest, "编号")
	if got := CountRows[baby.Profile](t, app, ""); got != 0 {
		t.Fatalf("非法建档载荷被拒后 SQLite 应保持 0 行，实际 %d", got)
	}

	// 3. 用户 A 建满 10 个宝宝后第 11 个返回 400，用户 B 仍可建档，A 删除 1 个后可再次新建。
	var firstID int64
	for i := 1; i <= 10; i++ {
		created := app.ScenarioFor(clientA).EnsureBaby(BabyParams{Nickname: fmt.Sprintf("宝宝%d", i)})
		if i == 1 {
			firstID = created.ID
		}
	}
	clientA.Post(t, "/api/babies?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "第11宝",
		BirthDate: "2026-08-01",
		Gender:    "male",
	}).RequireError(t, http.StatusBadRequest, "10")

	app.ScenarioFor(clientB).EnsureBaby(BabyParams{Nickname: "用户B首宝"})

	clientA.Delete(t, fmt.Sprintf("/api/babies/%d", firstID)).RequireStatus(t, http.StatusOK)
	clientA.Post(t, "/api/babies?tz=Asia/Shanghai", baby.UpsertInput{
		Nickname:  "补位宝",
		BirthDate: "2026-08-01",
		Gender:    "female",
	}).RequireStatus(t, http.StatusCreated)
}
