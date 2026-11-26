package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/nt1r/babylog/backend/internal/auth"
)

/*
 * Spec: user-management / Admin web user management API / Administrator creates, resets password, and disables an ordinary user via API; Reject duplicate username on web user creation
 * 测试场景：唯一管理员经 Web 接口完整管理普通用户的创建、列表查看、密码重置、停用与启用，且列表严守隐私边界不泄露宝宝或记录数。
 * 业务背景：管理员在 `/admin/users` 页面为亲友家庭开号与运维排障，既要确保每次重置/停用立即吊销旧会话，也要避免泄露家庭育儿数据统计。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录唯一管理员（admin）
 * - 宝宝档案：无（验证无宝宝的管理员可直接调用全部用户管理接口）
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证 POST /api/admin/users 创建普通用户（默认 role=user、must_change_password=true），并拒绝忽略大小写重复用户名（409）。
 * 2. 验证 GET /api/admin/users 仅返回非敏感账号元数据（不含宝宝数或记录数字段）。
 * 3. 验证重置密码与停用均立即吊销目标用户活跃会话并置位预期状态，重新启用后可使用重置后的新密码重新登录。
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

	// 3. 让 Alice 登录并改密后，管理员先重置密码再停用再启用，验证会话立即吊销与状态流转。
	aliceLogin := app.UnauthenticatedClient().Login(t, "Alice", "alice-initial-secret-123")
	aliceLogin.RequireStatus(t, http.StatusOK)
	aliceCookie, _ := aliceLogin.CookiePair(auth.SessionCookieName)
	aliceClient := app.UnauthenticatedClient().WithCookie(aliceCookie)
	changeResp := aliceClient.Post(t, "/api/auth/change-password", map[string]string{
		"current_password": "alice-initial-secret-123",
		"new_password":     "alice-private-secret-456",
	})
	changeResp.RequireStatus(t, http.StatusOK)
	rotatedCookie, _ := changeResp.CookiePair(auth.SessionCookieName)
	aliceActive := app.UnauthenticatedClient().WithCookie(rotatedCookie)

	resetResp := adminClient.Post(t, fmt.Sprintf("/api/admin/users/%d/reset-password", created.ID), map[string]string{
		"password": "alice-temp-reset-789",
	})
	resetSummary := DecodeOK[struct {
		User auth.UserSummary `json:"user"`
	}](t, resetResp).User
	if !resetSummary.MustChangePassword {
		t.Fatalf("Web 重置密码后应标记 must_change_password=true，实际 %+v", resetSummary)
	}
	aliceActive.Get(t, "/api/babies").RequireError(t, http.StatusUnauthorized, "登录")

	reLogin := app.UnauthenticatedClient().Login(t, "alice", "alice-temp-reset-789")
	reLogin.RequireStatus(t, http.StatusOK)
	reCookie, _ := reLogin.CookiePair(auth.SessionCookieName)
	aliceReAuthed := app.UnauthenticatedClient().WithCookie(reCookie)

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", created.ID), map[string]bool{"disabled": true}).
		RequireStatus(t, http.StatusOK)
	if DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, aliceReAuthed.Get(t, "/api/auth/session")).User != nil {
		t.Fatalf("停用后 Alice 会话应立即失效")
	}

	adminClient.Patch(t, fmt.Sprintf("/api/admin/users/%d", created.ID), map[string]bool{"disabled": false}).
		RequireStatus(t, http.StatusOK)
	app.UnauthenticatedClient().Login(t, "Alice", "alice-temp-reset-789").RequireStatus(t, http.StatusOK)
}

/*
 * Spec: user-management / Admin web user management API / Reject ordinary user access to admin endpoints; Reject admin self-disable or self-reset via admin endpoints
 * 测试场景：验证纵向权限隔离（普通用户访问全部 /api/admin/users* 返回 403）及唯一管理员自我保护（禁止经管理接口停用或重置自身）。
 * 业务背景：防止普通用户横向查看账号清单或越权建号/停号，同时防止唯一管理员在 Web 端误锁自己导致整个实例不可管理。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：管理员已登录，普通用户 Dave 已完成首次改密并登录
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证普通用户 Dave 调用全部 /api/admin/users* 端点均返回 403 且不改动任何用户数据。
 * 2. 验证唯一管理员尝试对自身 ID 执行停用（PATCH）或重置密码（POST reset-password）均返回 400 且自身会话保持正常。
 */
func TestAdminUserManagementRoleAndSelfProtectionGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	adminClient := app.Client()
	daveClient, dave := app.CreateReadyUserViaAdmin("Dave", "dave-init-secret-123", "dave-final-secret-456")

	// 1. 普通用户访问全部管理员接口一律 403 Forbidden。
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

	// 2. 唯一管理员自身不可在管理接口被停用或重置密码，且自身状态与会话保持完好。
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
