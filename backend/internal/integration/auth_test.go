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
 * Spec: admin-auth / Session restoration and expiration / Restore active session; Clear expired or unknown session cookie
 * Spec: admin-auth / Administrator logout / Revoke session on logout
 * Spec: admin-auth / Administrator login and session creation / Reject invalid credentials
 * 场景：覆盖管理员认证全链路（正常主流程 → 会话轮换与过期清理 → 无效凭据与未知 Cookie 拒绝）。
 * 前置：每项子测试独立初始化临时 SQLite 与可控时钟，按需启用或关闭自动登录。
 * 目标：
 * 1. 验证登录签发 HttpOnly/SameSite=Strict Cookie、恢复会话及登出吊销并清除 SQLite sessions。
 * 2. 验证重复登录轮换令牌使旧 Cookie 失效，以及 FakeClock 推进 7 天后自动清除过期会话。
 * 3. 验证错误凭据、未初始化管理员与畸形 Cookie 的拒绝语义及零脏会话。
 */
func TestAuthSessionLifecycle(t *testing.T) {
	t.Parallel()

	t.Run("正常主流程_登录恢复会话与登出吊销", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t, WithoutAutoLogin())
		anon := app.UnauthenticatedClient()

		// 1. 匿名探测会话返回 200 {user: null} 且禁止缓存。
		initResp := anon.Get(t, "/api/auth/session")
		initResp.RequireStatus(t, http.StatusOK)
		if got := initResp.Header.Get("Cache-Control"); got != "no-store" {
			t.Errorf("expected Cache-Control=no-store, got %q", got)
		}
		initBody := DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, initResp)
		if initBody.User != nil {
			t.Fatalf("expected user=nil before login, got %+v", initBody.User)
		}

		// 2. 正确凭据登录返回管理员信息、安全属性完整的 43 位会话 Cookie，并在 SQLite 落库。
		loginResp := anon.Login(t, defaultAdminUser, defaultAdminPass)
		loginResp.RequireStatus(t, http.StatusOK)
		loginBody := DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, loginResp)
		if loginBody.User == nil || loginBody.User.Username != defaultAdminUser || loginBody.User.Role != "admin" {
			t.Fatalf("unexpected login user: %+v", loginBody.User)
		}
		setCookie := loginResp.SetCookieHeader()
		cookiePattern := regexp.MustCompile(`^` + auth.SessionCookieName + `=[A-Za-z0-9_-]{43};`)
		if !cookiePattern.MatchString(setCookie) {
			t.Fatalf("unexpected Set-Cookie token format: %q", setCookie)
		}
		if !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "SameSite=Strict") || !strings.Contains(setCookie, "Path=/") {
			t.Fatalf("missing security flags in Set-Cookie: %q", setCookie)
		}
		if got := CountRows[auth.Session](t, app, ""); got != 1 {
			t.Fatalf("expected 1 persisted session after login, got %d", got)
		}

		cookiePair, ok := loginResp.CookiePair(auth.SessionCookieName)
		if !ok {
			t.Fatalf("missing %s cookie on login response", auth.SessionCookieName)
		}
		authed := anon.WithCookie(cookiePair)

		// 3. 携带有效 Cookie 恢复活跃会话。
		restoreResp := authed.Get(t, "/api/auth/session")
		restoreResp.RequireStatus(t, http.StatusOK)
		restoreBody := DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, restoreResp)
		if restoreBody.User == nil || restoreBody.User.Username != defaultAdminUser || restoreBody.User.Role != "admin" {
			t.Fatalf("unexpected restored user: %+v", restoreBody.User)
		}

		// 4. 登出吊销 SQLite 会话并下发 Max-Age=0，旧令牌再次探测返回 null 且被清除。
		logoutResp := authed.Post(t, "/api/auth/logout", nil)
		logoutResp.RequireStatus(t, http.StatusOK)
		if !strings.Contains(logoutResp.SetCookieHeader(), "Max-Age=0") {
			t.Fatalf("expected Max-Age=0 on logout, got %q", logoutResp.SetCookieHeader())
		}
		logoutBody := DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, logoutResp)
		if logoutBody.User != nil {
			t.Fatalf("expected user=nil on logout, got %+v", logoutBody.User)
		}
		if got := CountRows[auth.Session](t, app, ""); got != 0 {
			t.Fatalf("expected 0 sessions in SQLite after logout, got %d", got)
		}

		staleResp := authed.Get(t, "/api/auth/session")
		staleResp.RequireStatus(t, http.StatusOK)
		if !strings.Contains(staleResp.SetCookieHeader(), "Max-Age=0") {
			t.Fatalf("expected Max-Age=0 clearing revoked cookie, got %q", staleResp.SetCookieHeader())
		}
		staleBody := DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, staleResp)
		if staleBody.User != nil {
			t.Fatalf("expected user=nil for revoked cookie, got %+v", staleBody.User)
		}
	})

	t.Run("边界_重复登录轮换会话令牌并吊销旧Cookie", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		oldClient := app.Client()

		// 1. 携带现有有效会话再次登录，服务端应签发全新令牌并吊销旧令牌。
		rotateResp := oldClient.Login(t, defaultAdminUser, defaultAdminPass)
		rotateResp.RequireStatus(t, http.StatusOK)
		newCookiePair, ok := rotateResp.CookiePair(auth.SessionCookieName)
		if !ok {
			t.Fatalf("expected rotated session cookie, got %q", rotateResp.SetCookieHeader())
		}
		newClient := app.UnauthenticatedClient().WithCookie(newCookiePair)

		// 2. 验证 SQLite 仅保留 1 条新会话，旧 Cookie 立即失效且被清除，新 Cookie 正常可用。
		if got := CountRows[auth.Session](t, app, ""); got != 1 {
			t.Fatalf("expected exactly 1 session after rotation, got %d", got)
		}
		oldResp := oldClient.Get(t, "/api/auth/session")
		oldResp.RequireStatus(t, http.StatusOK)
		if !strings.Contains(oldResp.SetCookieHeader(), "Max-Age=0") {
			t.Fatalf("expected Max-Age=0 clearing rotated-out cookie, got %q", oldResp.SetCookieHeader())
		}
		if DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, oldResp).User != nil {
			t.Fatalf("expected old cookie invalidated after rotation")
		}

		newResp := newClient.Get(t, "/api/auth/session")
		newResp.RequireStatus(t, http.StatusOK)
		if got := DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, newResp).User; got == nil || got.Username != defaultAdminUser {
			t.Fatalf("expected new rotated session active, got %+v", got)
		}
	})

	t.Run("边界_推进时钟超过7天后过期会话自动清除", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)

		// 1. 推进时钟越过 7 天有效期。
		app.Clock.Advance(time.Duration(auth.SessionMaxAgeSeconds+1) * time.Second)

		// 2. 访问受保护接口返回 401；探测会话返回 {user: null} + Max-Age=0 且 SQLite 清理过期行。
		unauthBaby := app.Client().Get(t, "/api/baby")
		unauthBaby.RequireError(t, http.StatusUnauthorized, "")

		sessResp := app.Client().Get(t, "/api/auth/session")
		sessResp.RequireStatus(t, http.StatusOK)
		if !strings.Contains(sessResp.SetCookieHeader(), "Max-Age=0") {
			t.Fatalf("expected Max-Age=0 clearing expired cookie, got %q", sessResp.SetCookieHeader())
		}
		if DecodeJSON[struct {
			User *auth.AdminUser `json:"user"`
		}](t, sessResp).User != nil {
			t.Fatalf("expected user=nil after session expiration")
		}
		if got := CountRows[auth.Session](t, app, ""); got != 0 {
			t.Fatalf("expected expired session deleted from SQLite, remaining=%d", got)
		}
	})

	t.Run("拒绝_错误凭据未初始化管理员与畸形Cookie", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t, WithoutAutoLogin())
		anon := app.UnauthenticatedClient()

		// 1. 错误密码与错误用户名均返回 401 且不签发 Cookie、不写库。
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
				t.Errorf("%s: expected no Set-Cookie on 401, got %q", tc.name, sc)
			}
		}
		if got := CountRows[auth.Session](t, app, ""); got != 0 {
			t.Fatalf("expected 0 sessions after failed logins, got %d", got)
		}

		// 2. 携带畸形或未知 Cookie 探测会话返回 {user: null} 并下发 Max-Age=0 清除。
		for _, badCookie := range []string{
			auth.SessionCookieName + "=malformed-short",
			auth.SessionCookieName + "=" + strings.Repeat("A", 43),
		} {
			resp := anon.WithCookie(badCookie).Get(t, "/api/auth/session")
			resp.RequireStatus(t, http.StatusOK)
			if !strings.Contains(resp.SetCookieHeader(), "Max-Age=0") {
				t.Errorf("cookie %q: expected Max-Age=0, got %q", badCookie, resp.SetCookieHeader())
			}
			if DecodeJSON[struct {
				User *auth.AdminUser `json:"user"`
			}](t, resp).User != nil {
				t.Errorf("cookie %q: expected user=nil", badCookie)
			}
		}

		// 3. 未初始化管理员时登录返回 401 且不产生会话。
		uninitApp := NewTestApp(t, WithoutAdmin())
		uninitResp := uninitApp.UnauthenticatedClient().Login(t, defaultAdminUser, defaultAdminPass)
		uninitResp.RequireError(t, http.StatusUnauthorized, "")
		if got := CountRows[auth.Session](t, uninitApp, ""); got != 0 {
			t.Fatalf("expected 0 sessions on uninitialized app, got %d", got)
		}
	})
}
