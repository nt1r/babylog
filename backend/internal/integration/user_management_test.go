package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: user-management / Admin web user management API / Administrator creates, resets password, and disables an ordinary user via API; Reject duplicate username on web user creation
 * 测试场景：唯一管理员经 Web 接口完整管理普通用户的创建、列表查看、密码重置、停用与启用，且列表严守隐私边界不泄露宝宝或记录数。
 * 业务背景：管理员在 `/admin/users` 页面为亲友家庭开号与运维排障，既要确保每次重置/停用立即吊销旧会话，也要避免泄露家庭育儿数据统计，且启停用不损失家庭既有数据。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录唯一管理员（admin）
 * - 宝宝档案：无（验证无宝宝的管理员可直接调用全部用户管理接口；步骤 3 为 Alice 建档并写入记录以验证停用/启用后数据无损）
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证 POST /api/admin/users 创建普通用户（默认 role=user、must_change_password=true），并拒绝忽略大小写重复用户名（409）。
 * 2. 验证 GET /api/admin/users 仅返回非敏感账号元数据（不含宝宝数或记录数字段）。
 * 3. 验证重置密码与停用均立即吊销目标用户全部会话（旧密失效、新密进入待改密 403 门禁），重新启用后可使用重置后的新密码登录且既有宝宝与记录完好无损。
 */
func TestAdminUserManagementLifecycleClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	adminClient := app.Client()

	// 1. 创建普通用户 Alice 并验证忽略大小写重名返回 409。
	createResp := adminClient.Post(t, "/api/admin/users", map[string]string{
		"username": "Alice",
		"password": "alice-initial-secret-123",
	})
	created := DecodeStatus[struct {
		User auth.UserSummary `json:"user"`
	}](t, createResp, http.StatusCreated).User
	if created.ID <= 0 || created.Username != "Alice" || created.Role != auth.RoleUser ||
		created.Disabled || !created.MustChangePassword || created.CreatedAt == "" {
		t.Fatalf("新建普通用户返回元数据异常：%+v", created)
	}

	adminClient.Post(t, "/api/admin/users", map[string]string{
		"username": "alice",
		"password": "another-valid-secret-123",
	}).RequireError(t, http.StatusConflict, "已存在")

	// 2. 验证 GET /api/admin/users 仅返回账号元数据，绝不包含宝宝/记录数量或密码哈希字段。
	listResp := adminClient.Get(t, "/api/admin/users")
	listResp.RequireStatus(t, http.StatusOK)
	var rawList struct {
		Users []map[string]any `json:"users"`
	}
	if err := json.Unmarshal(listResp.Body, &rawList); err != nil {
		t.Fatalf("解析用户列表原始 JSON 失败: %v", err)
	}
	if len(rawList.Users) != 2 {
		t.Fatalf("预期用户列表含 2 名用户（admin + Alice），实际 %d", len(rawList.Users))
	}
	for _, forbidden := range []string{"password_hash", "password_salt", "baby_count", "babies", "record_count"} {
		if _, exists := rawList.Users[1][forbidden]; exists {
			t.Fatalf("用户列表不得暴露敏感或业务字段 %q：%v", forbidden, rawList.Users[1])
		}
	}

	// 3. 让 Alice 登录改密并建娃写入记录，随后验证重置密码（吊销会话/旧密失效/新密进 403 门禁）、停用与启用后业务数据完好。
	aliceLogin := app.UnauthenticatedClient().Login(t, "Alice", "alice-initial-secret-123")
	aliceLogin.RequireStatus(t, http.StatusOK)
	aliceClient := app.UnauthenticatedClient().WithCookie(aliceLogin.RequireCookiePair(t, auth.SessionCookieName))
	changeResp := aliceClient.Post(t, "/api/auth/change-password", map[string]string{
		"current_password": "alice-initial-secret-123",
		"new_password":     "alice-private-secret-456",
	})
	changeResp.RequireStatus(t, http.StatusOK)
	aliceActive := app.UnauthenticatedClient().WithCookie(changeResp.RequireCookiePair(t, auth.SessionCookieName))

	sAlice := app.ScenarioFor(aliceActive)
	aliceBaby := sAlice.EnsureBaby(BabyParams{Nickname: "Alice宝"})
	sAlice.AddFormula(135, "2026-11-23T01:00:00Z")

	resetResp := adminClient.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", created.ID), map[string]string{
		"password": "alice-temp-reset-789",
	})
	resetSummary := DecodeOK[struct {
		User auth.UserSummary `json:"user"`
	}](t, resetResp).User
	if !resetSummary.MustChangePassword {
		t.Fatalf("Web 重置密码后应标记 must_change_password=true，实际 %+v", resetSummary)
	}
	if got := CountRows[auth.Session](t, app, "user_id = ?", created.ID); got != 0 {
		t.Fatalf("重置密码后 SQLite 中 Alice 活跃会话应归零，实际剩余 %d", got)
	}
	aliceActive.Get(t, "/api/babies").RequireError(t, http.StatusUnauthorized, "登录")
	app.UnauthenticatedClient().Login(t, "Alice", "alice-private-secret-456").
		RequireError(t, http.StatusUnauthorized, "账号或密码")

	reLogin := app.UnauthenticatedClient().Login(t, "alice", "alice-temp-reset-789")
	reLogin.RequireStatus(t, http.StatusOK)
	aliceReAuthed := app.UnauthenticatedClient().WithCookie(reLogin.RequireCookiePair(t, auth.SessionCookieName))
	// 重置密码后处于强制改密门禁，直接访问 /api/babies 应返回 403 PASSWORD_CHANGE_REQUIRED。
	gatePayload := DecodeStatus[struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}](t, aliceReAuthed.Get(t, "/api/babies"), http.StatusForbidden)
	if gatePayload.Code != "PASSWORD_CHANGE_REQUIRED" {
		t.Fatalf("重置密码后登录应进入强制改密门禁，实际 %+v", gatePayload)
	}

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", created.ID), map[string]bool{"disabled": true}).
		RequireStatus(t, http.StatusOK)
	if got := CountRows[auth.Session](t, app, "user_id = ?", created.ID); got != 0 {
		t.Fatalf("停用后 SQLite 中 Alice 活跃会话应归零，实际剩余 %d", got)
	}
	if DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, aliceReAuthed.Get(t, "/api/auth/session")).User != nil {
		t.Fatalf("停用后 Alice 会话应立即失效")
	}

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", created.ID), map[string]bool{"disabled": false}).
		RequireStatus(t, http.StatusOK)
	reenableLogin := app.UnauthenticatedClient().Login(t, "Alice", "alice-temp-reset-789")
	reenableLogin.RequireStatus(t, http.StatusOK)
	reenableChange := app.UnauthenticatedClient().WithCookie(reenableLogin.RequireCookiePair(t, auth.SessionCookieName)).Post(t, "/api/auth/change-password", map[string]string{
		"current_password": "alice-temp-reset-789",
		"new_password":     "alice-restored-secret-999",
	})
	reenableChange.RequireStatus(t, http.StatusOK)
	aliceRestored := app.UnauthenticatedClient().WithCookie(reenableChange.RequireCookiePair(t, auth.SessionCookieName))

	restoredBabies := DecodeOK[struct {
		Babies []baby.Profile `json:"babies"`
	}](t, aliceRestored.Get(t, "/api/babies")).Babies
	if len(restoredBabies) != 1 || restoredBabies[0].ID != aliceBaby.ID || restoredBabies[0].Nickname != "Alice宝" {
		t.Fatalf("重新启用后 Alice 宝宝档案应完整保留，实际 %+v", restoredBabies)
	}
	restoredFeeds := DecodeOK[records.ListResult[records.FeedingRecord, records.FeedingDailySummary]](
		t,
		aliceRestored.Get(t, babyPath(aliceBaby.ID, "/records/feeding?range=all&tz=Asia/Shanghai")),
	)
	if restoredFeeds.Total != 1 || len(restoredFeeds.Items) != 1 || restoredFeeds.Items[0].AmountML == nil || *restoredFeeds.Items[0].AmountML != 135 {
		t.Fatalf("重新启用后 Alice 喂养记录应完整保留，实际 total=%d items=%+v", restoredFeeds.Total, restoredFeeds.Items)
	}
}

/*
 * Spec: user-management / Admin web user management API / Reject ordinary user access to admin endpoints; Reject admin self-disable or self-reset via admin endpoints
 * 测试场景：验证管理员接口的未认证拦截（401）、普通用户越权拦截（403）、非法入参（400）与未知用户（404）防线及唯一管理员自我保护。
 * 业务背景：防止匿名与普通用户越权查看或篡改账号，同时拦截非法载荷/编号并防止唯一管理员在 Web 端误锁自己导致实例不可管理。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：管理员已登录、普通用户 Dave 已完成首次改密并登录、另持匿名客户端
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名访问全部 /api/admin/users* 返回 401，普通用户 Dave 访问全部 /api/admin/users* 返回 403 且不改动任何用户数据。
 * 2. 验证非法建号/改状态/重置密码载荷与非法路径 :id 返回 400（零脏写），不存在的用户 ID 返回 404。
 * 3. 验证唯一管理员尝试对自身 ID 执行停用（PATCH）或重置密码（POST reset-password）均返回 400 且自身会话保持正常。
 */
func TestAdminUserManagementRoleAndSelfProtectionGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	adminClient := app.Client()
	daveClient, dave := app.CreateReadyUserViaAdmin("Dave", "dave-init-secret-123", "dave-final-secret-456")

	// 1. 匿名访问一律 401，普通用户访问全部管理员接口一律 403 Forbidden。
	anon.Get(t, "/api/admin/users").RequireError(t, http.StatusUnauthorized, "登录")
	anon.Post(t, "/api/admin/users", map[string]string{"username": "anon", "password": "anon-secret-123456"}).
		RequireError(t, http.StatusUnauthorized, "登录")
	anon.Patch(t, fmt.Sprintf("/api/admin/users/%d", dave.ID), map[string]bool{"disabled": true}).
		RequireError(t, http.StatusUnauthorized, "登录")
	anon.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", dave.ID), map[string]string{"password": "anon-reset-123456"}).
		RequireError(t, http.StatusUnauthorized, "登录")

	daveClient.Get(t, "/api/admin/users").RequireError(t, http.StatusForbidden, "管理员")
	daveClient.Post(t, "/api/admin/users", map[string]string{
		"username": "rogue",
		"password": "rogue-secret-123456",
	}).RequireError(t, http.StatusForbidden, "管理员")
	daveClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", dave.ID), map[string]bool{"disabled": true}).
		RequireError(t, http.StatusForbidden, "管理员")
	daveClient.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", dave.ID), map[string]string{
		"password": "rogue-reset-123456",
	}).RequireError(t, http.StatusForbidden, "管理员")

	// 2. 非法载荷与非法路径 :id 均返回 400 且零脏写；不存在用户 ID 返回 404。
	beforeUserCount := CountRows[auth.User](t, app, "")
	for _, badCreate := range []map[string]any{
		{"username": " extra", "password": "valid-secret-123456"},
		{"username": "validuser", "password": "too-short"},
		{"username": strings.Repeat("u", auth.MaxUsernameLength+1), "password": "valid-secret-123456"},
		{"username": "validuser", "password": "valid-secret-123456", "role": "admin"},
		{"username": 123, "password": "valid-secret-123456"},
	} {
		adminClient.Post(t, "/api/admin/users", badCreate).RequireError(t, http.StatusBadRequest, "")
	}
	if afterCount := CountRows[auth.User](t, app, ""); afterCount != beforeUserCount {
		t.Fatalf("非法创建用户载荷被拒后用户总数应保持 %d，实际 %d", beforeUserCount, afterCount)
	}

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", dave.ID), map[string]any{}).
		RequireError(t, http.StatusBadRequest, "停用状态")
	adminClient.Patch(t, "/api/admin/users/abc", map[string]bool{"disabled": true}).
		RequireError(t, http.StatusBadRequest, "编号")
	adminClient.Patch(t, "/api/admin/users/0", map[string]bool{"disabled": true}).
		RequireError(t, http.StatusBadRequest, "编号")
	adminClient.Patch(t, "/api/admin/users/999999", map[string]bool{"disabled": true}).
		RequireError(t, http.StatusNotFound, "")

	adminClient.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", dave.ID), map[string]any{
		"password": "short",
	}).RequireError(t, http.StatusBadRequest, "12")
	adminClient.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", dave.ID), map[string]any{
		"password": "valid-secret-123456",
		"extra":    true,
	}).RequireError(t, http.StatusBadRequest, "格式不正确")
	adminClient.Post(t, "/api/admin/users/abc/reset-password", map[string]string{
		"password": "valid-secret-123456",
	}).RequireError(t, http.StatusBadRequest, "编号")
	adminClient.Post(t, "/api/admin/users/999999/reset-password", map[string]string{
		"password": "valid-secret-123456",
	}).RequireError(t, http.StatusNotFound, "")

	// 3. 唯一管理员自身不可在管理接口被停用或重置密码，且自身状态与会话保持完好。
	adminSess := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, adminClient.Get(t, "/api/auth/session")).User
	if adminSess == nil {
		t.Fatal("管理员会话意外为空")
	}

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", adminSess.ID), map[string]bool{"disabled": true}).
		RequireError(t, http.StatusBadRequest, "唯一管理员")
	adminClient.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", adminSess.ID), map[string]string{
		"password": "self-reset-attempt-123",
	}).RequireError(t, http.StatusBadRequest, "唯一管理员")

	stillAdmin := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, adminClient.Get(t, "/api/auth/session")).User
	if stillAdmin == nil || stillAdmin.ID != adminSess.ID || stillAdmin.MustChangePassword {
		t.Fatalf("自保护拒绝后管理员会话与状态应保持不变：%+v", stillAdmin)
	}
}
