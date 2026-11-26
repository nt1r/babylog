package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/records"
)

/*
 * Spec: admin-auth / Administrator login and session creation / Reject cross-origin state-changing requests; Reject unsupported content type or oversized login body
 * Spec: daily-records / Authenticated access and baby-profile precondition for records
 * 测试场景：验证全局 API 安全中间件、严格 JSON 契约解码、HTTP 方法路由兜底与未预期 Panic 恢复。
 * 业务背景：所有状态变更接口面临跨站 CSRF、超大载荷、非 JSON 伪造及前后端字段漂移风险，必须在路由中间件与解码层统一拦死并保证零脏写。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：默认档案小汤圆（2026-07-15，female）
 * - 前置业务记录：无（步骤 1 内为测试 PUT/DELETE 跨源先写入 1 条配方奶记录）
 * 测试目标：
 * 1. 验证 POST/PUT/DELETE 跨源请求均返回 403 且无脏写，而省略 Origin 请求头的同源/非浏览器写请求正常放行。
 * 2. 验证非 JSON Content-Type 返回 415，超限请求体（登录 >16KiB、业务 >64KiB）返回 413。
 * 3. 验证登录畸形载荷、业务接口未知字段（DisallowUnknownFields）与尾随多 JSON 均返回 400，非法方法返回 405，未知 /api/* 返回 404。
 * 4. 验证未预期 panic 被恢复中间件捕获并统一返回中文 500 JSON。
 */
func TestAPISecurityGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	b := s.EnsureBaby()
	feedURL := babyPath(b.ID, "/records/feeding")
	client := app.Client()

	// 1. 跨来源保护覆盖 POST/PUT/DELETE 全部写方法且零脏写；无 Origin 头由 SameSite=Strict Cookie 兜底允许正常写入。
	evilClient := client.WithOrigin("http://evil.example")
	for _, tc := range []struct {
		path string
		body any
	}{
		{"/api/auth/login", map[string]string{"username": defaultAdminUser, "password": defaultAdminPass}},
		{"/api/auth/logout", nil},
		{"/api/auth/change-password", map[string]string{"current_password": defaultAdminPass, "new_password": "new-cross-origin-secret"}},
		{feedURL, map[string]any{"subtype": "formula", "amount_ml": 100, "recorded_at": "2026-11-23T01:00:00Z"}},
	} {
		evilClient.Post(t, tc.path, tc.body).RequireError(t, http.StatusForbidden, "跨来源")
	}
	if got := CountRows[records.FeedingRecord](t, app, ""); got != 0 {
		t.Fatalf("跨源 POST 被拒后不应落库喂养记录，实际 %d", got)
	}

	// 省略 Origin 头发起合法写入（模拟同源直调或非浏览器客户端），随后验证跨源 PUT/DELETE 同样返回 403 且记录完好。
	noOriginResp := client.WithOrigin("").Post(t, feedURL, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   ptr(100),
		RecordedAt: "2026-11-23T01:00:00Z",
	})
	created := DecodeStatus[struct {
		Record records.FeedingRecord `json:"record"`
	}](t, noOriginResp, http.StatusCreated).Record

	evilClient.Put(t, fmt.Sprintf("%s/%d", feedURL, created.ID), records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   ptr(180),
		RecordedAt: "2026-11-23T01:00:00Z",
	}).RequireError(t, http.StatusForbidden, "跨来源")
	evilClient.Delete(t, fmt.Sprintf("%s/%d", feedURL, created.ID)).
		RequireError(t, http.StatusForbidden, "跨来源")
	if row := FirstRow[records.FeedingRecord](t, app, "id = ?", created.ID); row.AmountML == nil || *row.AmountML != 100 {
		t.Fatalf("跨源 PUT/DELETE 被拒后原记录不应被篡改或删除：%+v", row)
	}

	// 2. 非 JSON Content-Type 返回 415，超限请求体返回 413。
	client.DoRaw(t, http.MethodPost, "/api/auth/login", "text/plain", []byte("username=admin")).
		RequireError(t, http.StatusUnsupportedMediaType, "")
	client.DoRaw(t, http.MethodPost, feedURL, "text/plain", []byte("subtype=formula")).
		RequireError(t, http.StatusUnsupportedMediaType, "")

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
	client.DoRaw(t, http.MethodPost, feedURL, "application/json", oversizedRecord).
		RequireError(t, http.StatusRequestEntityTooLarge, "")

	// 3. 登录畸形 JSON、业务未知字段（防拼写漂移静默吞掉）、尾随多余 JSON、非法方法 405 与未知路由 404 全部精确拦截。
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
	for _, raw := range []string{
		`{"subtype":"formula","amount_ml":120,"recorded_at":"2026-11-23T01:10:00Z","unknown_field":1}`,
		`{"subtype":"formula","amount_ml":120,"recorded_at":"2026-11-23T01:10:00Z"}{"extra":true}`,
	} {
		client.DoRaw(t, http.MethodPost, feedURL, "application/json", []byte(raw)).
			RequireError(t, http.StatusBadRequest, "格式不正确")
	}
	if got := CountRows[records.FeedingRecord](t, app, ""); got != 1 {
		t.Fatalf("非法 JSON 被拒后记录总数应仍为 1，实际 %d", got)
	}

	client.Delete(t, "/api/auth/session").RequireError(t, http.StatusMethodNotAllowed, "")
	client.Get(t, "/api/unknown").RequireError(t, http.StatusNotFound, "")

	// 4. 挂载模拟 panic 路由，核对恢复中间件统一兜底为中文 500 JSON 且不崩溃进程。
	app.Router.GET("/api/test-panic", func(_ *gin.Context) {
		panic("simulated panic")
	})
	client.Get(t, "/api/test-panic").RequireError(t, http.StatusInternalServerError, "服务器暂时无法处理请求")
}

/*
 * 范围：基础设施（无对应 OpenSpec 规格）
 * 测试场景：验证静态资源托管、SPA 路由回退、PWA 缓存策略及路径穿越/符号链接逃逸防护。
 * 业务背景：单二进制发布态由后端直接托管前端构建产物，既要确保刷新子路由能回退 index.html 并遵循 PWA 缓存头，也要防路径穿越读取宿主机敏感文件。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：未登录匿名客户端
 * - 宝宝档案：无
 * - 前置业务记录：启用 WithDistFixtures() 在临时目录构造 index.html、manifest.webmanifest、sw.js、带哈希 JS 与指向外部 secret.txt 的符号链接
 * 测试目标：
 * 1. 验证无扩展名 SPA 路由（/dashboard）回退 index.html，返回 text/html 与 Cache-Control: no-cache。
 * 2. 验证 manifest.webmanifest、sw.js 与带哈希静态资源的 MIME 类型和缓存头策略（no-cache vs immutable）。
 * 3. 验证缺失资源、编码路径穿越（/%2e%2e/secret.txt）与符号链接逃逸（/escape.txt）全部返回 404。
 */
func TestStaticAssetsAndSPAFallback(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t, WithoutAutoLogin(), WithDistFixtures())
	anon := app.UnauthenticatedClient()

	// 1. 刷新前端深层路由时必须回退 index.html 并禁止强缓存，防止发布后卡在旧入口 HTML。
	spaResp := anon.Get(t, "/dashboard")
	spaResp.RequireStatus(t, http.StatusOK)
	if ct := spaResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("SPA 回退预期 text/html，实际 %q", ct)
	}
	if cc := spaResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("index.html 预期 Cache-Control=no-cache，实际 %q", cc)
	}
	if !strings.Contains(string(spaResp.Body), "BabyLog Test") {
		t.Errorf("SPA 回退 HTML 内容不符合预期：%q", string(spaResp.Body))
	}

	// 2. 核对 PWA 清单、Service Worker 与内容哈希资源的 MIME 及缓存策略，避免 SW 缓存卡死更新。
	manifestResp := anon.Get(t, "/manifest.webmanifest")
	manifestResp.RequireStatus(t, http.StatusOK)
	if ct := manifestResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("manifest 预期 application/manifest+json，实际 %q", ct)
	}
	if cc := manifestResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("manifest 预期 Cache-Control=no-cache，实际 %q", cc)
	}

	swResp := anon.Get(t, "/sw.js")
	swResp.RequireStatus(t, http.StatusOK)
	if cc := swResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("sw.js 预期 Cache-Control=no-cache，实际 %q", cc)
	}

	assetResp := anon.Get(t, "/assets/app-hash123.js")
	assetResp.RequireStatus(t, http.StatusOK)
	if cc := assetResp.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("带哈希静态资源预期 immutable 缓存头，实际 %q", cc)
	}

	// 3. 缺失静态资源、编码路径穿越与指向目录外敏感文件的符号链接均须返回 404，杜绝越界读文件。
	for _, targetPath := range []string{"/assets/missing.js", "/%2e%2e/secret.txt", "/escape.txt"} {
		anon.Get(t, targetPath).RequireStatus(t, http.StatusNotFound)
	}
}
