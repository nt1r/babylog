package integration_test

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/auth"
)

/*
 * Spec: admin-auth / Administrator login and session creation / Successful administrator login
 * Spec: admin-auth / Session restoration and expiration / Restore active session
 * Spec: admin-auth / Administrator logout / Revoke session on logout
 * 测试场景：用户大小写不敏感登录、会话恢复、以及多用户并存时单方登出仅吊销自身会话不影响他人。
 * 业务背景：家庭用户在浏览器打开 BabyLog 时先探测登录态，登录后依赖 HttpOnly/SameSite=Strict Cookie 维持会话；多用户场景下一方退出绝不得影响其他在线账号。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员（admin）并额外创建普通用户 Alice；同时持有匿名客户端视图
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名探测 GET /api/auth/session 返回 200 {user: null} 且禁止缓存（Cache-Control: no-store）。
 * 2. 验证大小写不敏感凭据登录返回完整用户信息（id/username/role/must_change_password）、43 位安全 Cookie，并可恢复会话。
 * 3. 验证管理员退出后仅吊销自身会话并下发 Max-Age=0，而在线普通用户 Alice 的会话依然有效。
 */
func TestAuthLoginRestoreAndLogoutClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	aliceClient, _ := app.CreateReadyUserViaAdmin("Alice", "alice-init-secret-123", "alice-final-secret-456")
	anon := app.UnauthenticatedClient()

	// 1. 匿名探测会话：确认返回 {user: null} 且响应头禁止缓存，避免前端或代理误缓存匿名态。
	initResp := anon.Get(t, "/api/auth/session")
	initResp.RequireStatus(t, http.StatusOK)
	if got := initResp.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("预期会话探测 Cache-Control=no-store，实际 %q", got)
	}
	initBody := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, initResp)
	if initBody.User != nil {
		t.Fatalf("未登录时预期 user=nil，实际 %+v", initBody.User)
	}

	// 2. 大小写不敏感凭据登录：核对安全 Cookie 属性、展示原始大小写及会话恢复。
	loginResp := anon.Login(t, "ADMIN", defaultAdminPass)
	loginResp.RequireStatus(t, http.StatusOK)
	loginBody := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, loginResp)
	if loginBody.User == nil || loginBody.User.ID <= 0 || loginBody.User.Username != defaultAdminUser ||
		loginBody.User.Role != auth.RoleAdmin || loginBody.User.MustChangePassword {
		t.Fatalf("登录返回用户信息不符合预期：%+v", loginBody.User)
	}
	setCookie := loginResp.SetCookieHeader()
	cookiePattern := regexp.MustCompile(`^` + auth.SessionCookieName + `=[A-Za-z0-9_-]{43};`)
	if !cookiePattern.MatchString(setCookie) {
		t.Fatalf("签发的会话令牌格式不符合 43 位 base64url 契约：%q", setCookie)
	}
	if !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "SameSite=Strict") || !strings.Contains(setCookie, "Path=/") {
		t.Fatalf("会话 Cookie 缺少必要安全属性：%q", setCookie)
	}

	cookiePair, ok := loginResp.CookiePair(auth.SessionCookieName)
	if !ok {
		t.Fatalf("登录响应缺少 %s Cookie", auth.SessionCookieName)
	}
	authed := anon.WithCookie(cookiePair)

	restoreResp := authed.Get(t, "/api/auth/session")
	restoreBody := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, restoreResp)
	if restoreBody.User == nil || restoreBody.User.Username != defaultAdminUser || restoreBody.User.Role != auth.RoleAdmin {
		t.Fatalf("会话恢复返回的用户信息异常：%+v", restoreBody.User)
	}

	// 3. 登出仅吊销调用方当前令牌，不影响在线普通用户 Alice 的会话。
	logoutResp := authed.Post(t, "/api/auth/logout", nil)
	logoutResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(logoutResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("登出响应缺少 Max-Age=0 清除指令：%q", logoutResp.SetCookieHeader())
	}
	if got := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, logoutResp).User; got != nil {
		t.Fatalf("登出响应预期 user=nil，实际 %+v", got)
	}

	staleResp := authed.Get(t, "/api/auth/session")
	staleResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(staleResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("已吊销 Cookie 探测会话应返回 Max-Age=0，实际 %q", staleResp.SetCookieHeader())
	}
	if DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, staleResp).User != nil {
		t.Fatalf("已吊销 Cookie 不得恢复登录态")
	}

	aliceSess := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, aliceClient.Get(t, "/api/auth/session")).User
	if aliceSess == nil || aliceSess.Username != "Alice" || aliceSess.Role != auth.RoleUser {
		t.Fatalf("管理员登出后普通用户 Alice 会话应保持有效，实际 %+v", aliceSess)
	}
}

/*
 * Spec: admin-auth / Administrator login and session creation / Successful administrator login; Enforce Secure cookie flag when BABYLOG_COOKIE_SECURE is enabled
 * Spec: admin-auth / Session restoration and expiration / Clear expired or unknown session cookie
 * 测试场景：已登录会话再次提交登录时轮换会话令牌并立即吊销旧 Cookie，且开启 BABYLOG_COOKIE_SECURE 时强制下发 Secure 标志。
 * 业务背景：防止会话固定攻击及同浏览器切号残留旧会话，同时保障反代终结 TLS 部署场景下 Cookie 依然带 Secure 属性。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：启用 WithCookieSecure() 初始化并登录管理员，持有旧会话 Cookie
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证携带旧 Cookie 再次登录签发全新含 Secure 属性的令牌，且 SQLite 仅保留 1 条新会话记录。
 * 2. 验证旧 Cookie 立即失效并收到 Max-Age=0 清除指令，而新 Cookie 可正常恢复会话。
 */
func TestAuthSessionRotationOnRelogin(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t, WithCookieSecure())
	oldClient := app.Client()

	// 1. 携带现有有效会话重新登录，核对签发全新含 Secure 的会话 Cookie 且数据库仅保留唯一活跃会话。
	rotateResp := oldClient.Login(t, defaultAdminUser, defaultAdminPass)
	rotateResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(rotateResp.SetCookieHeader(), "Secure") {
		t.Fatalf("开启 BABYLOG_COOKIE_SECURE 后应强制下发 Secure Cookie，实际 %q", rotateResp.SetCookieHeader())
	}
	newCookiePair, ok := rotateResp.CookiePair(auth.SessionCookieName)
	if !ok {
		t.Fatalf("重复登录未返回轮换后的会话 Cookie：%q", rotateResp.SetCookieHeader())
	}
	newClient := app.UnauthenticatedClient().WithCookie(newCookiePair)

	if got := CountRows[auth.Session](t, app, ""); got != 1 {
		t.Fatalf("会话轮换后 SQLite 应仅保留 1 条活跃会话，实际 %d", got)
	}

	// 2. 验证旧会话已被吊销且新会话持续有效，排除旧令牌遗留可用的会话固定风险。
	oldResp := oldClient.Get(t, "/api/auth/session")
	oldResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(oldResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("轮换失效的旧 Cookie 应收到 Max-Age=0 清除指令，实际 %q", oldResp.SetCookieHeader())
	}
	if DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, oldResp).User != nil {
		t.Fatalf("轮换后的旧 Cookie 不得继续恢复登录态")
	}

	newResp := newClient.Get(t, "/api/auth/session")
	if got := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, newResp).User; got == nil || got.Username != defaultAdminUser {
		t.Fatalf("轮换后的新会话应正常生效，实际 %+v", got)
	}
}

/*
 * Spec: admin-auth / Session restoration and expiration / Clear expired or unknown session cookie
 * 测试场景：会话超过 7 天有效期后自动失效，受保护接口拒绝访问并清除 Cookie，会话探测清理 SQLite 过期行。
 * 业务背景：用户一周未操作后再次打开应用，过期的会话令牌必须被立即拒绝并清理，避免过期凭据滞留客户端或数据库。
 * 前置数据：
 * - 时钟与时区：初始 2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员并登录，SQLite 中有 1 条有效会话
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证 FakeClock 推进 7 天 + 1 秒后，携带过期 Cookie 访问 GET /api/babies 返回 401 中文错误并同步下发 Max-Age=0 清除 Cookie。
 * 2. 验证携带过期 Cookie 探测 GET /api/auth/session 返回 200 {user: null} + Max-Age=0，且 SQLite 中过期会话已被清理归零。
 */
func TestAuthSessionExpirationCleanup(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)

	app.Clock.Advance(time.Duration(auth.SessionMaxAgeSeconds+1) * time.Second)

	// 1. 携带过期 Cookie 访问受保护接口，核对返回 401 且同步下发清除 Cookie 头。
	unauthBabies := app.Client().Get(t, "/api/babies")
	unauthBabies.RequireError(t, http.StatusUnauthorized, "登录")
	if !strings.Contains(unauthBabies.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("受保护接口拒绝过期 Cookie 时应下发 Max-Age=0，实际 %q", unauthBabies.SetCookieHeader())
	}

	// 2. 探测会话接口应返回 {user: null} + Max-Age=0，并确保 SQLite 中的过期会话行已彻底删除。
	sessResp := app.Client().Get(t, "/api/auth/session")
	sessResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(sessResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("会话探测收到过期 Cookie 应下发 Max-Age=0，实际 %q", sessResp.SetCookieHeader())
	}
	if DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, sessResp).User != nil {
		t.Fatalf("过期会话不得恢复登录态")
	}
	if got := CountRows[auth.Session](t, app, ""); got != 0 {
		t.Fatalf("过期会话行应已从 SQLite 清理，实际剩余 %d", got)
	}
}

/*
 * Spec: admin-auth / Self-service password change / Successfully change own password and revoke other sessions; Reject password change with incorrect current password; Reject unchanged password during forced password change
 * Spec: admin-auth / Mandatory password change gate / Block business and admin APIs while password change is required
 * 测试场景：管理员创建待改密用户后，验证强制改密门禁拦截业务与管理接口、改密校验失败拦截，以及改密成功轮换当前会话并踢出其他端会话。
 * 业务背景：管理员代建账号的初始密码经外部渠道转交，必须在用户首次登录后强制替换为私人密码并立即吊销其余潜在终端会话。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：管理员创建普通用户 Bob（must_change_password=true），Bob 在两台设备分别登录持有两个会话
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证待改密态访问 /api/babies、/api/babies/1/records/feeding 与 /api/admin/users 统一返回 403 PASSWORD_CHANGE_REQUIRED，而 GET /api/auth/session 放行。
 * 2. 验证错误当前密码返回 401、强制改密态提交相同新旧密码返回 400，且均不修改密码或清除待改密标记。
 * 3. 验证提交合法新密码返回 200（must_change_password=false）并签发轮换新 Cookie，另一设备旧会话立即失效（401），新会话可正常访问 /api/babies。
 */
func TestAuthForcedAndSelfServicePasswordChangeClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	device1, _ := app.CreateUserViaAdmin("Bob", "bob-temp-secret-123")
	login2 := app.UnauthenticatedClient().Login(t, "bob", "bob-temp-secret-123")
	login2.RequireStatus(t, http.StatusOK)
	cookie2, _ := login2.CookiePair(auth.SessionCookieName)
	device2 := app.UnauthenticatedClient().WithCookie(cookie2)

	// 1. 待改密门禁拦截业务与管理端点并返回结构化 PASSWORD_CHANGE_REQUIRED 错误码，但放行会话探测。
	for _, path := range []string{"/api/babies", "/api/babies/1/records/feeding", "/api/admin/users"} {
		resp := device1.Get(t, path)
		payload := DecodeStatus[struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}](t, resp, http.StatusForbidden)
		if payload.Code != "PASSWORD_CHANGE_REQUIRED" || !strings.Contains(payload.Error, "修改初始密码") {
			t.Fatalf("待改密态访问 %s 响应异常：%+v", path, payload)
		}
	}
	sessUser := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, device1.Get(t, "/api/auth/session")).User
	if sessUser == nil || !sessUser.MustChangePassword {
		t.Fatalf("待改密态会话探测应返回 must_change_password=true，实际 %+v", sessUser)
	}

	// 2. 错误旧密码返回 401，强制改密态下新旧密码相同返回 400，且均保留待改密态与原密码。
	device1.Post(t, "/api/auth/change-password", map[string]string{
		"current_password": "wrong-current-secret",
		"new_password":     "bob-brand-new-secret-789",
	}).RequireError(t, http.StatusUnauthorized, "当前密码")

	device1.Post(t, "/api/auth/change-password", map[string]string{
		"current_password": "bob-temp-secret-123",
		"new_password":     "bob-temp-secret-123",
	}).RequireError(t, http.StatusBadRequest, "不能与初始密码相同")

	// 3. 合法改密成功清除标记、轮换设备 1 会话、踢出设备 2 会话并解锁 /api/babies。
	okResp := device1.Post(t, "/api/auth/change-password", map[string]string{
		"current_password": "bob-temp-secret-123",
		"new_password":     "bob-brand-new-secret-789",
	})
	updated := DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, okResp).User
	if updated == nil || updated.MustChangePassword {
		t.Fatalf("改密成功后 must_change_password 应为 false，实际 %+v", updated)
	}
	rotatedCookie, ok := okResp.CookiePair(auth.SessionCookieName)
	if !ok {
		t.Fatalf("改密成功后未返回轮换会话 Cookie")
	}
	device1New := app.UnauthenticatedClient().WithCookie(rotatedCookie)

	device2.Get(t, "/api/babies").RequireError(t, http.StatusUnauthorized, "登录")
	device1.Get(t, "/api/babies").RequireError(t, http.StatusUnauthorized, "登录")
	device1New.Get(t, "/api/babies").RequireStatus(t, http.StatusOK)
}

/*
 * Spec: admin-auth / Administrator login and session creation / Reject invalid credentials; Reject disabled user after password verification succeeds
 * Spec: admin-auth / Login brute-force throttling and scrypt concurrency guard / Throttle repeated failed login attempts for a username
 * Spec: admin-auth / Session restoration and expiration / Clear expired or unknown session cookie
 * 测试场景：验证错误凭据与未初始化拒绝、停用账号输错密 401 vs 输对密 403、按用户名 15 分钟 10 次失败限流 429 与畸形 Cookie 清除。
 * 业务背景：多用户暴露后既要防止用户名枚举与暴力撞库，也要让被停用用户在输对密码时收到清晰指引，并在停用后立即失效旧会话。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员并创建普通用户 Carol（后续停用）；另建未初始化管理员隔离环境
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证错误密码、错误用户名与停用账号输错密码统一返回 401，而停用账号输对密码返回 403 且其既有会话立即失效。
 * 2. 验证同一归一化用户名 15 分钟内连续失败 10 次后第 11 次返回 429，推进时钟 15 分钟后恢复可登录。
 * 3. 验证畸形/未知 Cookie 探测会话收到 Max-Age=0，且未初始化环境拒绝登录并保持零会话。
 */
func TestAuthInvalidCredentialsThrottleAndDisabledGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	carolClient, carolSummary := app.CreateReadyUserViaAdmin("Carol", "carol-init-secret-123", "carol-final-secret-456")
	anon := app.UnauthenticatedClient()

	// 1. 停用 Carol 后核对既有会话立即被清退，输错密码仍返回统一 401，输对密码返回 403 提示联系管理员。
	app.Client().Patch(t, fmt.Sprintf("/api/admin/users/%d", carolSummary.ID), map[string]bool{"disabled": true}).
		RequireStatus(t, http.StatusOK)

	carolSessResp := carolClient.Get(t, "/api/auth/session")
	carolSessResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(carolSessResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("停用用户探测会话应下发 Max-Age=0，实际 %q", carolSessResp.SetCookieHeader())
	}
	if DecodeOK[struct {
		User *auth.AuthUser `json:"user"`
	}](t, carolSessResp).User != nil {
		t.Fatalf("停用用户会话不得恢复登录态")
	}

	anon.Login(t, "Carol", "wrong-password-12345").RequireError(t, http.StatusUnauthorized, "账号或密码")
	anon.Login(t, "unknown-user", defaultAdminPass).RequireError(t, http.StatusUnauthorized, "账号或密码")
	anon.Login(t, "carol", "carol-final-secret-456").RequireError(t, http.StatusForbidden, "停用")

	// 2. 针对同一归一化用户名连续 10 次错误登录触发第 11 次 429 限流，推进 15 分钟后自动解除。
	for i := 0; i < 10; i++ {
		name := "admin"
		if i%2 == 1 {
			name = "ADMIN"
		}
		anon.Login(t, name, "wrong-attempt-secret").RequireError(t, http.StatusUnauthorized, "账号或密码")
	}
	anon.Login(t, "admin", defaultAdminPass).RequireError(t, http.StatusTooManyRequests, "频繁")

	app.Clock.Advance(15 * time.Minute)
	anon.Login(t, "admin", defaultAdminPass).RequireStatus(t, http.StatusOK)

	// 3. 畸形/未知 Cookie 探测会话下发清除指令，且未初始化管理员环境拒绝登录保持零会话。
	for _, badCookie := range []string{
		auth.SessionCookieName + "=malformed-short",
		auth.SessionCookieName + "=" + strings.Repeat("A", 43),
	} {
		resp := anon.WithCookie(badCookie).Get(t, "/api/auth/session")
		resp.RequireStatus(t, http.StatusOK)
		if !strings.Contains(resp.SetCookieHeader(), "Max-Age=0") {
			t.Errorf("异常 Cookie %q 预期收到 Max-Age=0，实际 %q", badCookie, resp.SetCookieHeader())
		}
		if DecodeOK[struct {
			User *auth.AuthUser `json:"user"`
		}](t, resp).User != nil {
			t.Errorf("异常 Cookie %q 不得恢复用户态", badCookie)
		}
	}

	uninitApp := NewTestApp(t, WithoutAdmin())
	uninitApp.UnauthenticatedClient().Login(t, defaultAdminUser, defaultAdminPass).
		RequireError(t, http.StatusUnauthorized, "")
	if got := CountRows[auth.Session](t, uninitApp, ""); got != 0 {
		t.Fatalf("未初始化环境登录失败后应保持零会话，实际 %d", got)
	}
}
