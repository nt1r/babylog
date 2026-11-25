package integration_test

import (
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
 * 测试场景：管理员首次登录、携带会话 Cookie 恢复登录态，以及退出登录后彻底吊销会话。
 * 业务背景：家庭管理员在浏览器打开 BabyLog 时先探测登录态，登录后依赖 HttpOnly/SameSite=Strict Cookie 维持会话，退出后旧 Cookie 不得继续访问或复原会话。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员（admin），尚未登录（匿名客户端）
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名探测 GET /api/auth/session 返回 200 {user: null} 且禁止缓存（Cache-Control: no-store）。
 * 2. 验证正确凭据登录返回管理员信息、含 HttpOnly/SameSite=Strict/Path=/ 的 43 位会话 Cookie，并在 SQLite 落库 1 条会话；随后可凭该 Cookie 恢复会话。
 * 3. 验证登出吊销 SQLite 会话并下发 Max-Age=0，携带旧 Cookie 再次探测返回 {user: null} 并再次收到清除指令。
 */
func TestAuthLoginRestoreAndLogoutClosedLoop(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t, WithoutAutoLogin())
	anon := app.UnauthenticatedClient()

	// 1. 匿名探测会话：确认返回 {user: null} 且响应头禁止缓存，避免前端或代理误缓存匿名态。
	initResp := anon.Get(t, "/api/auth/session")
	initResp.RequireStatus(t, http.StatusOK)
	if got := initResp.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("预期会话探测 Cache-Control=no-store，实际 %q", got)
	}
	initBody := DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, initResp)
	if initBody.User != nil {
		t.Fatalf("未登录时预期 user=nil，实际 %+v", initBody.User)
	}

	// 2. 正确凭据登录：核对安全 Cookie 属性、SQLite 会话落库，并验证携带该 Cookie 恢复活跃会话。
	loginResp := anon.Login(t, defaultAdminUser, defaultAdminPass)
	loginResp.RequireStatus(t, http.StatusOK)
	loginBody := DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, loginResp)
	if loginBody.User == nil || loginBody.User.Username != defaultAdminUser || loginBody.User.Role != "admin" {
		t.Fatalf("登录返回管理员信息不符合预期：%+v", loginBody.User)
	}
	setCookie := loginResp.SetCookieHeader()
	cookiePattern := regexp.MustCompile(`^` + auth.SessionCookieName + `=[A-Za-z0-9_-]{43};`)
	if !cookiePattern.MatchString(setCookie) {
		t.Fatalf("签发的会话令牌格式不符合 43 位 base64url 契约：%q", setCookie)
	}
	if !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "SameSite=Strict") || !strings.Contains(setCookie, "Path=/") {
		t.Fatalf("会话 Cookie 缺少必要安全属性：%q", setCookie)
	}
	if got := CountRows[auth.Session](t, app, ""); got != 1 {
		t.Fatalf("登录后 SQLite 应落库 1 条会话，实际 %d", got)
	}

	cookiePair, ok := loginResp.CookiePair(auth.SessionCookieName)
	if !ok {
		t.Fatalf("登录响应缺少 %s Cookie", auth.SessionCookieName)
	}
	authed := anon.WithCookie(cookiePair)

	restoreResp := authed.Get(t, "/api/auth/session")
	restoreResp.RequireStatus(t, http.StatusOK)
	restoreBody := DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, restoreResp)
	if restoreBody.User == nil || restoreBody.User.Username != defaultAdminUser || restoreBody.User.Role != "admin" {
		t.Fatalf("会话恢复返回的管理员信息异常：%+v", restoreBody.User)
	}

	// 3. 登出并回读校验：确认 SQLite 会话行被物理删除且旧 Cookie 无法继续恢复会话。
	logoutResp := authed.Post(t, "/api/auth/logout", nil)
	logoutResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(logoutResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("登出响应缺少 Max-Age=0 清除指令：%q", logoutResp.SetCookieHeader())
	}
	if got := DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, logoutResp).User; got != nil {
		t.Fatalf("登出响应预期 user=nil，实际 %+v", got)
	}
	if got := CountRows[auth.Session](t, app, ""); got != 0 {
		t.Fatalf("登出后 SQLite 会话应清零，实际剩余 %d", got)
	}

	staleResp := authed.Get(t, "/api/auth/session")
	staleResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(staleResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("已吊销 Cookie 探测会话应返回 Max-Age=0，实际 %q", staleResp.SetCookieHeader())
	}
	if got := DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, staleResp).User; got != nil {
		t.Fatalf("已吊销 Cookie 不得恢复登录态，实际 %+v", got)
	}
}

/*
 * Spec: admin-auth / Administrator login and session creation / Successful administrator login
 * Spec: admin-auth / Session restoration and expiration / Clear expired or unknown session cookie
 * 测试场景：已登录会话再次提交登录时轮换会话令牌并立即吊销旧 Cookie。
 * 业务背景：管理员在已有活跃会话的情况下重新提交登录表单时，服务端必须轮换会话令牌防止会话固定攻击，且不得在 SQLite 中残留旧会话。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员并完成首次登录，持有旧会话 Cookie
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证携带旧 Cookie 再次登录返回全新令牌，且 SQLite 仅保留 1 条新会话记录。
 * 2. 验证旧 Cookie 立即失效并收到 Max-Age=0 清除指令，而新 Cookie 可正常恢复会话。
 */
func TestAuthSessionRotationOnRelogin(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	oldClient := app.Client()

	// 1. 携带现有有效会话重新登录，核对签发全新会话 Cookie 且数据库仅保留唯一活跃会话。
	rotateResp := oldClient.Login(t, defaultAdminUser, defaultAdminPass)
	rotateResp.RequireStatus(t, http.StatusOK)
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
		User *auth.AdminUser `json:"user"`
	}](t, oldResp).User != nil {
		t.Fatalf("轮换后的旧 Cookie 不得继续恢复登录态")
	}

	newResp := newClient.Get(t, "/api/auth/session")
	newResp.RequireStatus(t, http.StatusOK)
	if got := DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, newResp).User; got == nil || got.Username != defaultAdminUser {
		t.Fatalf("轮换后的新会话应正常生效，实际 %+v", got)
	}
}

/*
 * Spec: admin-auth / Session restoration and expiration / Clear expired or unknown session cookie
 * 测试场景：会话超过 7 天有效期后自动失效，受保护接口拒绝访问并清除 Cookie，会话探测清理 SQLite 过期行。
 * 业务背景：管理员一周未操作后再次打开应用，过期的会话令牌必须被立即拒绝并清理，避免过期凭据滞留客户端或数据库。
 * 前置数据：
 * - 时钟与时区：初始 2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化管理员并登录，SQLite 中有 1 条有效会话
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证 FakeClock 推进 7 天 + 1 秒后，携带过期 Cookie 访问 GET /api/baby 返回 401 中文错误并同步下发 Max-Age=0 清除 Cookie。
 * 2. 验证携带过期 Cookie 探测 GET /api/auth/session 返回 200 {user: null} + Max-Age=0，且 SQLite 中过期会话已被清理归零。
 */
func TestAuthSessionExpirationCleanup(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)

	// 前置推进时钟：精确越过 7 天有效期（SessionMaxAgeSeconds + 1 秒），不使用 sleep。
	app.Clock.Advance(time.Duration(auth.SessionMaxAgeSeconds+1) * time.Second)

	// 1. 携带过期 Cookie 访问受保护接口，核对返回 401 且同步下发清除 Cookie 头，避免前端死循环携带失效凭据。
	unauthBaby := app.Client().Get(t, "/api/baby")
	unauthBaby.RequireError(t, http.StatusUnauthorized, "登录")
	if !strings.Contains(unauthBaby.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("受保护接口拒绝过期 Cookie 时应下发 Max-Age=0，实际 %q", unauthBaby.SetCookieHeader())
	}

	// 2. 探测会话接口应返回 {user: null} + Max-Age=0，并确保 SQLite 中的过期会话行已彻底删除。
	sessResp := app.Client().Get(t, "/api/auth/session")
	sessResp.RequireStatus(t, http.StatusOK)
	if !strings.Contains(sessResp.SetCookieHeader(), "Max-Age=0") {
		t.Fatalf("会话探测收到过期 Cookie 应下发 Max-Age=0，实际 %q", sessResp.SetCookieHeader())
	}
	if DecodeOK[struct {
		User *auth.AdminUser `json:"user"`
	}](t, sessResp).User != nil {
		t.Fatalf("过期会话不得恢复登录态")
	}
	if got := CountRows[auth.Session](t, app, ""); got != 0 {
		t.Fatalf("过期会话行应已从 SQLite 清理，实际剩余 %d", got)
	}
}

/*
 * Spec: admin-auth / Administrator login and session creation / Reject invalid credentials
 * Spec: admin-auth / Session restoration and expiration / Clear expired or unknown session cookie
 * 测试场景：拒绝错误凭据与未初始化管理员登录，并自动清除畸形或未知会话 Cookie。
 * 业务背景：防止凭据暴力猜测泄露账号存在性，确保认证失败零脏会话，同时兜底清理损坏或伪造的客户端 Cookie。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：主隔离环境已初始化管理员未登录；另建一套未初始化管理员的隔离环境
 * - 宝宝档案：无
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证错误密码与错误用户名登录均返回 401 中文错误、不下发 Set-Cookie 且 SQLite 保持零会话。
 * 2. 验证畸形短令牌与未知 43 位随机令牌探测会话均返回 {user: null} 并下发 Max-Age=0。
 * 3. 验证尚未执行 CLI 初始化管理员的环境拒绝登录（401）且零脏会话。
 */
func TestAuthInvalidCredentialsMalformedCookieAndUninit(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t, WithoutAutoLogin())
	anon := app.UnauthenticatedClient()

	// 1. 错误密码与错误用户名均返回统一 401 中文错误，不签发 Cookie 且不在数据库创建任何会话。
	for _, tc := range []struct {
		name string
		user string
		pass string
	}{
		{"错误密码", defaultAdminUser, "wrong-password-12345"},
		{"错误用户名", "other-admin", defaultAdminPass},
	} {
		resp := anon.Login(t, tc.user, tc.pass)
		resp.RequireError(t, http.StatusUnauthorized, "账号或密码")
		if sc := resp.SetCookieHeader(); sc != "" {
			t.Errorf("%s：401 响应不得下发 Set-Cookie，实际 %q", tc.name, sc)
		}
	}
	if got := CountRows[auth.Session](t, app, ""); got != 0 {
		t.Fatalf("登录失败后 SQLite 不应存在会话，实际 %d", got)
	}

	// 2. 携带格式畸形或数据库中不存在的会话 Cookie 探测会话，均返回空用户并下发清除指令。
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
			User *auth.AdminUser `json:"user"`
		}](t, resp).User != nil {
			t.Errorf("异常 Cookie %q 不得恢复用户态", badCookie)
		}
	}

	// 3. 未初始化管理员的全新数据库尝试登录必须返回 401 且零脏会话。
	uninitApp := NewTestApp(t, WithoutAdmin())
	uninitResp := uninitApp.UnauthenticatedClient().Login(t, defaultAdminUser, defaultAdminPass)
	uninitResp.RequireError(t, http.StatusUnauthorized, "")
	if got := CountRows[auth.Session](t, uninitApp, ""); got != 0 {
		t.Fatalf("未初始化环境登录失败后应保持零会话，实际 %d", got)
	}
}
