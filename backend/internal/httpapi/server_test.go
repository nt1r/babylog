package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/httpapi"
)

const (
	testAdminUser = "admin"
	testAdminPass = "babylog-integration-secret"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

func setupTestServer(t *testing.T) (*httptest.Server, *gin.Engine) {
	t.Helper()

	tempRoot := t.TempDir()
	dataDir := filepath.Join(tempRoot, "data")
	distDir := filepath.Join(tempRoot, "dist")
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		t.Fatalf("mkdir dist: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("<!doctype html><title>BabyLog Test</title>"), 0o644); err != nil {
		t.Fatalf("write index.html: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "manifest.webmanifest"), []byte(`{"name":"BabyLog"}`), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "sw.js"), []byte("self.addEventListener('fetch', () => {});"), 0o644); err != nil {
		t.Fatalf("write sw.js: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(distDir, "assets"), 0o755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "assets", "app-hash123.js"), []byte("console.log('ok');"), 0o644); err != nil {
		t.Fatalf("write hashed asset: %v", err)
	}
	// 在 dist 外部写入文件并创建指向它的符号链接，用于验证路径穿越与符号链接逃逸防护。
	outsideFile := filepath.Join(tempRoot, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("top-secret"), 0o600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	_ = os.Symlink(outsideFile, filepath.Join(distDir, "escape.txt"))

	db, err := database.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	store := auth.NewStore(db.Gorm())
	if err := store.InitializeAdministrator(context.Background(), testAdminUser, testAdminPass); err != nil {
		t.Fatalf("init admin: %v", err)
	}

	router := httpapi.NewRouter(httpapi.Options{
		Store:   store,
		DistDir: distDir,
	})
	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)

	return ts, router
}

func decodeJSONMap(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer func() { _ = resp.Body.Close() }()
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	return data
}

func TestAuthLifecycle(t *testing.T) {
	ts, _ := setupTestServer(t)
	client := ts.Client()

	// 初始未登录状态。
	resp, err := client.Get(ts.URL + "/api/auth/session")
	if err != nil {
		t.Fatalf("GET session: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("expected Cache-Control=no-store, got %q", got)
	}
	body := decodeJSONMap(t, resp)
	if body["user"] != nil {
		t.Fatalf("expected user=nil, got %#v", body["user"])
	}

	// 错误密码登录返回 401 且不设 Cookie。
	invalidReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login",
		strings.NewReader(`{"username":"admin","password":"wrong-password-12345"}`))
	invalidReq.Header.Set("Content-Type", "application/json")
	invalidReq.Header.Set("Origin", ts.URL)
	invalidResp, err := client.Do(invalidReq)
	if err != nil {
		t.Fatalf("POST invalid login: %v", err)
	}
	_ = invalidResp.Body.Close()
	if invalidResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", invalidResp.StatusCode)
	}
	if sc := invalidResp.Header.Get("Set-Cookie"); sc != "" {
		t.Fatalf("expected no Set-Cookie on 401, got %q", sc)
	}

	// 正确凭据登录。
	loginPayload, _ := json.Marshal(map[string]string{"username": testAdminUser, "password": testAdminPass})
	loginReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", bytes.NewReader(loginPayload))
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.Header.Set("Origin", ts.URL)
	loginResp, err := client.Do(loginReq)
	if err != nil {
		t.Fatalf("POST login: %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on login, got %d", loginResp.StatusCode)
	}
	setCookie := loginResp.Header.Get("Set-Cookie")
	loginBody := decodeJSONMap(t, loginResp)
	userObj, _ := loginBody["user"].(map[string]any)
	if userObj["username"] != testAdminUser || userObj["role"] != "admin" {
		t.Fatalf("unexpected login user: %#v", loginBody["user"])
	}

	cookiePattern := regexp.MustCompile(`^` + auth.SessionCookieName + `=[A-Za-z0-9_-]{43};`)
	if !cookiePattern.MatchString(setCookie) {
		t.Fatalf("unexpected Set-Cookie token format: %q", setCookie)
	}
	if !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "SameSite=Strict") {
		t.Fatalf("missing security flags in Set-Cookie: %q", setCookie)
	}
	cookieHeader := strings.SplitN(setCookie, ";", 2)[0]

	// 携带 Cookie 恢复会话。
	sessionReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/auth/session", nil)
	sessionReq.Header.Set("Cookie", cookieHeader)
	sessionResp, err := client.Do(sessionReq)
	if err != nil {
		t.Fatalf("GET session with cookie: %v", err)
	}
	if sessionResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on session restore, got %d", sessionResp.StatusCode)
	}
	sessionBody := decodeJSONMap(t, sessionResp)
	restoredUser, _ := sessionBody["user"].(map[string]any)
	if restoredUser["username"] != testAdminUser || restoredUser["role"] != "admin" {
		t.Fatalf("unexpected restored user: %#v", sessionBody["user"])
	}

	// 登出吊销并下发 Max-Age=0。
	logoutReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/logout", nil)
	logoutReq.Header.Set("Origin", ts.URL)
	logoutReq.Header.Set("Cookie", cookieHeader)
	logoutResp, err := client.Do(logoutReq)
	if err != nil {
		t.Fatalf("POST logout: %v", err)
	}
	if logoutResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on logout, got %d", logoutResp.StatusCode)
	}
	if !strings.Contains(logoutResp.Header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("expected Max-Age=0 on logout, got %q", logoutResp.Header.Get("Set-Cookie"))
	}
	logoutBody := decodeJSONMap(t, logoutResp)
	if logoutBody["user"] != nil {
		t.Fatalf("expected user=nil after logout, got %#v", logoutBody["user"])
	}

	// 旧令牌再次恢复会话返回 null 并清除 Cookie。
	afterReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/auth/session", nil)
	afterReq.Header.Set("Cookie", cookieHeader)
	afterResp, err := client.Do(afterReq)
	if err != nil {
		t.Fatalf("GET session after logout: %v", err)
	}
	if afterResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 after logout, got %d", afterResp.StatusCode)
	}
	if !strings.Contains(afterResp.Header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("expected Max-Age=0 clearing stale cookie, got %q", afterResp.Header.Get("Set-Cookie"))
	}
	afterBody := decodeJSONMap(t, afterResp)
	if afterBody["user"] != nil {
		t.Fatalf("expected user=nil after logout, got %#v", afterBody["user"])
	}
}

func TestSecurityGuards(t *testing.T) {
	ts, router := setupTestServer(t)
	client := ts.Client()

	// 跨来源 login 与 logout 写请求均返回 403。
	for _, endpoint := range []string{"/api/auth/login", "/api/auth/logout"} {
		crossReq, _ := http.NewRequest(http.MethodPost, ts.URL+endpoint,
			strings.NewReader(`{"username":"admin","password":"`+testAdminPass+`"}`))
		crossReq.Header.Set("Content-Type", "application/json")
		crossReq.Header.Set("Origin", "http://evil.example")
		crossResp, err := client.Do(crossReq)
		if err != nil {
			t.Fatalf("cross origin req (%s): %v", endpoint, err)
		}
		_ = crossResp.Body.Close()
		if crossResp.StatusCode != http.StatusForbidden {
			t.Errorf("expected 403 for cross-origin %s, got %d", endpoint, crossResp.StatusCode)
		}
	}

	// 非 JSON Content-Type 返回 415。
	wrongCTReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", strings.NewReader("username=admin"))
	wrongCTReq.Header.Set("Content-Type", "text/plain")
	wrongCTReq.Header.Set("Origin", ts.URL)
	wrongCTResp, err := client.Do(wrongCTReq)
	if err != nil {
		t.Fatalf("wrong content-type req: %v", err)
	}
	_ = wrongCTResp.Body.Close()
	if wrongCTResp.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("expected 415 for text/plain, got %d", wrongCTResp.StatusCode)
	}

	// 超出 16 KiB 请求体返回 413。
	oversizedBody, _ := json.Marshal(map[string]string{
		"username": testAdminUser,
		"password": strings.Repeat("x", 20*1024),
	})
	overReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", bytes.NewReader(oversizedBody))
	overReq.Header.Set("Content-Type", "application/json")
	overReq.Header.Set("Origin", ts.URL)
	overResp, err := client.Do(overReq)
	if err != nil {
		t.Fatalf("oversized req: %v", err)
	}
	_ = overResp.Body.Close()
	if overResp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 for oversized body, got %d", overResp.StatusCode)
	}

	// 非法 JSON、非对象或字段类型错误返回 400。
	malformedPayloads := []string{
		`{invalid`,
		`["admin","secret"]`,
		`{"username":"admin"}`,
		`{"username":123,"password":"secret"}`,
		`{"username":"admin","password":null}`,
	}
	for _, raw := range malformedPayloads {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", strings.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", ts.URL)
		resp, reqErr := client.Do(req)
		if reqErr != nil {
			t.Fatalf("malformed login req (%s): %v", raw, reqErr)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("expected 400 for payload %s, got %d", raw, resp.StatusCode)
		}
	}

	// 方法不匹配返回 405，未知 API 返回 404。
	badMethodReq, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/auth/session", nil)
	badMethodReq.Header.Set("Origin", ts.URL)
	badMethodResp, err := client.Do(badMethodReq)
	if err != nil {
		t.Fatalf("bad method req: %v", err)
	}
	_ = badMethodResp.Body.Close()
	if badMethodResp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 for DELETE /api/auth/session, got %d", badMethodResp.StatusCode)
	}

	unknownAPIResp, err := client.Get(ts.URL + "/api/unknown")
	if err != nil {
		t.Fatalf("unknown api req: %v", err)
	}
	_ = unknownAPIResp.Body.Close()
	if unknownAPIResp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 for unknown api, got %d", unknownAPIResp.StatusCode)
	}

	// 未预期 panic 被恢复并返回统一 JSON 500 响应。
	router.GET("/api/test-panic", func(_ *gin.Context) {
		panic("simulated panic")
	})
	panicResp, err := client.Get(ts.URL + "/api/test-panic")
	if err != nil {
		t.Fatalf("GET panic route: %v", err)
	}
	if panicResp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500 on panic, got %d", panicResp.StatusCode)
	}
	panicBody := decodeJSONMap(t, panicResp)
	if panicBody["error"] != "服务器暂时无法处理请求" {
		t.Errorf("unexpected panic response body: %#v", panicBody)
	}
}

func TestStaticAndSPAFallback(t *testing.T) {
	ts, _ := setupTestServer(t)
	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	// 无扩展名 SPA 路由回退到 index.html。
	spaResp, err := client.Get(ts.URL + "/dashboard")
	if err != nil {
		t.Fatalf("GET /dashboard: %v", err)
	}
	spaHTML, _ := io.ReadAll(spaResp.Body)
	_ = spaResp.Body.Close()
	if spaResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for SPA route, got %d", spaResp.StatusCode)
	}
	if ct := spaResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type, got %q", ct)
	}
	if cc := spaResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected index.html Cache-Control=no-cache, got %q", cc)
	}
	if !strings.Contains(string(spaHTML), "BabyLog Test") {
		t.Errorf("unexpected SPA html body: %q", string(spaHTML))
	}

	// PWA manifest、Service Worker 与带哈希静态资源的 MIME 及缓存头校验。
	manifestResp, err := client.Get(ts.URL + "/manifest.webmanifest")
	if err != nil {
		t.Fatalf("GET manifest: %v", err)
	}
	_ = manifestResp.Body.Close()
	if manifestResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for manifest, got %d", manifestResp.StatusCode)
	}
	if ct := manifestResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("expected application/manifest+json, got %q", ct)
	}
	if cc := manifestResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected manifest Cache-Control=no-cache, got %q", cc)
	}

	swResp, err := client.Get(ts.URL + "/sw.js")
	if err != nil {
		t.Fatalf("GET sw.js: %v", err)
	}
	_ = swResp.Body.Close()
	if swResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for sw.js, got %d", swResp.StatusCode)
	}
	if cc := swResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected sw.js Cache-Control=no-cache, got %q", cc)
	}

	assetResp, err := client.Get(ts.URL + "/assets/app-hash123.js")
	if err != nil {
		t.Fatalf("GET hashed asset: %v", err)
	}
	_ = assetResp.Body.Close()
	if assetResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for hashed asset, got %d", assetResp.StatusCode)
	}
	if cc := assetResp.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("expected immutable Cache-Control for hashed asset, got %q", cc)
	}

	// 缺失静态资源返回 404。
	missingResp, err := client.Get(ts.URL + "/assets/missing.js")
	if err != nil {
		t.Fatalf("GET missing asset: %v", err)
	}
	_ = missingResp.Body.Close()
	if missingResp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 for missing asset, got %d", missingResp.StatusCode)
	}

	// 编码路径穿越与符号链接逃逸均返回 404。
	for _, targetPath := range []string{"/%2e%2e/secret.txt", "/escape.txt"} {
		resp, reqErr := client.Get(ts.URL + targetPath)
		if reqErr != nil {
			t.Fatalf("GET %s: %v", targetPath, reqErr)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("expected 404 for %s, got %d", targetPath, resp.StatusCode)
		}
	}
}
