package integration_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: admin-auth / Administrator login and session creation / Reject cross-origin state-changing requests; Reject unsupported content type or oversized login body
 * Spec: daily-records / Authenticated access and baby-profile precondition for records
 * 场景：验证全局 API 安全中间件基线（跨源 403、非 JSON 415、超限请求体 413、畸形 JSON 400、方法不匹配 405、未知路由 404 及 Panic 统一 500 恢复）。
 * 前置：已登录并建档的隔离测试环境。
 * 目标：
 * 1. 验证认证接口与业务写接口均受 Same-Origin、Content-Type 与请求体大小限制保护。
 * 2. 验证畸形登录载荷返回 400，非法 HTTP 方法返回 405，未知 /api/* 返回 404 JSON。
 * 3. 验证未预期 panic 被恢复中间件捕获并返回统一中文 500 JSON。
 */
func TestAPISecurityGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	app.Scenario().EnsureBaby()
	client := app.Client()

	// 1. 认证接口与业务写接口受跨来源（403）、非 JSON（415）与请求体大小上限（413）三重门禁保护。
	evilClient := client.WithOrigin("http://evil.example")
	for _, tc := range []struct {
		path string
		body any
	}{
		{"/api/auth/login", map[string]string{"username": defaultAdminUser, "password": defaultAdminPass}},
		{"/api/auth/logout", nil},
		{"/api/records/feeding", map[string]any{"subtype": "formula", "amount_ml": 100, "recorded_at": "2026-11-23T01:00:00Z"}},
	} {
		evilClient.Post(t, tc.path, tc.body).RequireError(t, http.StatusForbidden, "")
	}
	if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
		t.Fatalf("expected 0 feeding rows after cross-origin 403, got %d", got)
	}

	// 非 JSON Content-Type 返回 415。
	client.DoRaw(t, http.MethodPost, "/api/auth/login", "text/plain", []byte("username=admin")).
		RequireError(t, http.StatusUnsupportedMediaType, "")
	client.DoRaw(t, http.MethodPost, "/api/records/feeding", "text/plain", []byte("subtype=formula")).
		RequireError(t, http.StatusUnsupportedMediaType, "")

	// 超出请求体限制（登录 >16KiB，业务接口 >64KiB）返回 413。
	oversizedLogin, _ := json.Marshal(map[string]string{
		"username": defaultAdminUser,
		"password": strings.Repeat("x", 20*1024),
	})
	client.DoRaw(t, http.MethodPost, "/api/auth/login", "application/json", oversizedLogin).
		RequireError(t, http.StatusRequestEntityTooLarge, "")

	oversizedRecord, _ := json.Marshal(map[string]any{
		"subtype":     "formula",
		"amount_ml":   100,
		"recorded_at": "2026-11-23T01:00:00Z",
		"note":        strings.Repeat("a", 70*1024),
	})
	client.DoRaw(t, http.MethodPost, "/api/records/feeding", "application/json", oversizedRecord).
		RequireError(t, http.StatusRequestEntityTooLarge, "")

	// 2. 畸形登录载荷返回 400，方法不匹配返回 405，未知 /api/* 返回 404 JSON。
	for _, raw := range []string{
		`{invalid`,
		`["admin","secret"]`,
		`{"username":"admin"}`,
		`{"username":123,"password":"secret"}`,
		`{"username":"admin","password":null}`,
	} {
		client.DoRaw(t, http.MethodPost, "/api/auth/login", "application/json", []byte(raw)).
			RequireError(t, http.StatusBadRequest, "")
	}
	client.Delete(t, "/api/auth/session").RequireError(t, http.StatusMethodNotAllowed, "")
	client.Get(t, "/api/unknown").RequireError(t, http.StatusNotFound, "")

	// 3. 未预期 panic 由恢复中间件统一兜底为中文 500 JSON。
	app.Router.GET("/api/test-panic", func(_ *gin.Context) {
		panic("simulated panic")
	})
	client.Get(t, "/api/test-panic").RequireError(t, http.StatusInternalServerError, "服务器暂时无法处理请求")
}

/*
 * 范围：基础设施（无对应 OpenSpec 规格）
 * 场景：验证静态资源托管、SPA 路由回退、PWA 缓存头及路径穿越/符号链接逃逸防护。
 * 前置：启用 WithDistFixtures() 挂载隔离临时 dist 产物及指向外部敏感文件的符号链接。
 * 目标：
 * 1. 验证无扩展名 SPA 路由回退 index.html 且返回 text/html 与 Cache-Control: no-cache。
 * 2. 验证 manifest.webmanifest、sw.js 与带哈希静态资源的 MIME 类型和缓存头策略。
 * 3. 验证缺失资源、编码路径穿越（/%2e%2e/secret.txt）与符号链接逃逸（/escape.txt）均返回 404。
 */
func TestStaticAssetsAndSPAFallback(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t, WithoutAutoLogin(), WithDistFixtures())
	anon := app.UnauthenticatedClient()

	// 1. SPA 路由回退 index.html。
	spaResp := anon.Get(t, "/dashboard")
	spaResp.RequireStatus(t, http.StatusOK)
	if ct := spaResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type, got %q", ct)
	}
	if cc := spaResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected index.html Cache-Control=no-cache, got %q", cc)
	}
	if !strings.Contains(string(spaResp.Body), "BabyLog Test") {
		t.Errorf("unexpected SPA html body: %q", string(spaResp.Body))
	}

	// 2. PWA manifest、Service Worker 与带哈希静态资源的 MIME 与缓存头校验。
	manifestResp := anon.Get(t, "/manifest.webmanifest")
	manifestResp.RequireStatus(t, http.StatusOK)
	if ct := manifestResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("expected application/manifest+json, got %q", ct)
	}
	if cc := manifestResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected manifest Cache-Control=no-cache, got %q", cc)
	}

	swResp := anon.Get(t, "/sw.js")
	swResp.RequireStatus(t, http.StatusOK)
	if cc := swResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("expected sw.js Cache-Control=no-cache, got %q", cc)
	}

	assetResp := anon.Get(t, "/assets/app-hash123.js")
	assetResp.RequireStatus(t, http.StatusOK)
	if cc := assetResp.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("expected immutable Cache-Control for hashed asset, got %q", cc)
	}

	// 3. 缺失静态资源、编码路径穿越与符号链接逃逸均返回 404。
	for _, targetPath := range []string{"/assets/missing.js", "/%2e%2e/secret.txt", "/escape.txt"} {
		anon.Get(t, targetPath).RequireStatus(t, http.StatusNotFound)
	}
}
