// Package integration_test 提供 BabyLog 后端全链路黑盒 API 集成测试与可复用场景底座。
// 所有用例通过真实 httpapi.NewRouter 与独立临时 SQLite 运行，模拟 App 客户端调用并核验响应及落库终态。
package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/httpapi"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

const (
	defaultAdminUser = "admin"
	defaultAdminPass = "babylog-integration-secret"
	defaultTimezone  = "Asia/Shanghai"
)

// defaultFixedNow 固定在 2026-11-23 10:00:00+08:00（UTC 02:00:00），确保跨零点、多日趋势与疫苗提醒断言完全确定。
var defaultFixedNow = time.Date(2026, 11, 23, 2, 0, 0, 0, time.UTC)

// TestMain 在整个集成测试包启动前统一设置 Gin 为测试模式，避免并发用例修改全局模式引发竞态及调试日志噪音。
func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// ptr 是泛型指针构造助手，避免各测试文件重复编写 strPtr / intPtr / floatPtr 样板。
func ptr[T any](v T) *T {
	return &v
}

// FakeClock 提供并发安全的可控时钟，统一注入全部 Store 与 Service，彻底消除宿主机日期依赖与 sleep。
type FakeClock struct {
	mu  sync.RWMutex
	now time.Time
}

func NewFakeClock(initial time.Time) *FakeClock {
	return &FakeClock{now: initial}
}

func (c *FakeClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *FakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

type appConfig struct {
	initialNow   time.Time
	initAdmin    bool
	autoLogin    bool
	distFixtures bool
}

// AppOption 控制 NewTestApp 的初始化行为。
type AppOption func(*appConfig)

// WithClock 覆写测试应用初始固定时钟（默认使用 defaultFixedNow）。
func WithClock(initial time.Time) AppOption {
	return func(cfg *appConfig) {
		cfg.initialNow = initial
	}
}

// WithoutAdmin 跳过管理员初始化（同时关闭自动登录），用于验证未初始化状态下的行为。
func WithoutAdmin() AppOption {
	return func(cfg *appConfig) {
		cfg.initAdmin = false
		cfg.autoLogin = false
	}
}

// WithoutAutoLogin 初始化管理员但不自动登录，用于从匿名状态开始测试认证全流程。
func WithoutAutoLogin() AppOption {
	return func(cfg *appConfig) {
		cfg.autoLogin = false
	}
}

// WithDistFixtures 构建隔离的临时前端 dist 产物及越界符号链接，供静态资源与路径穿越防护测试使用。
func WithDistFixtures() AppOption {
	return func(cfg *appConfig) {
		cfg.distFixtures = true
	}
}

// TestApp 持有单个集成测试用例的隔离 SQLite、可控时钟、真实 HTTP 路由与客户端会话。
type TestApp struct {
	t      *testing.T
	Clock  *FakeClock
	Server *httptest.Server
	Router *gin.Engine
	db     *database.DB
	client *AppClient
}

// NewTestApp 为单个测试创建完全隔离的临时 SQLite 与内存回环 HTTP 服务。
// 通过 t.TempDir() 与 t.Cleanup 自动完成连接关闭和目录清理，天然支持 t.Parallel() 并发运行。
func NewTestApp(t *testing.T, opts ...AppOption) *TestApp {
	t.Helper()

	cfg := appConfig{
		initialNow: defaultFixedNow,
		initAdmin:  true,
		autoLogin:  true,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(&cfg)
		}
	}

	tempRoot := t.TempDir()
	assertIsolatedTempDir(t, tempRoot)

	dataDir := filepath.Join(tempRoot, "data")
	var distDir string
	if cfg.distFixtures {
		distDir = setupDistFixtures(t, tempRoot)
	}

	db, err := database.Open(dataDir)
	if err != nil {
		t.Fatalf("open isolated test sqlite: %v", err)
	}
	// Go t.Cleanup 按 LIFO 逆序执行：先注册 db.Close()，后注册 ts.Close()，确保关闭数据库前所有 HTTP 请求均已结束。
	t.Cleanup(func() {
		if closeErr := db.Close(); closeErr != nil {
			t.Errorf("close test sqlite: %v", closeErr)
		}
	})

	clock := NewFakeClock(cfg.initialNow)
	authStore := auth.NewStore(db.Gorm()).WithClock(clock.Now)
	if cfg.initAdmin {
		if err := authStore.InitializeAdministrator(context.Background(), defaultAdminUser, defaultAdminPass); err != nil {
			t.Fatalf("initialize test administrator: %v", err)
		}
	}

	babyStore := baby.NewStore(db.Gorm()).WithClock(clock.Now)
	recordStore := records.NewStore(db.Gorm()).WithClock(clock.Now)
	dashSvc := dashboard.NewService(recordStore).WithClock(clock.Now)
	vaccineStore := vaccines.NewStore(db.Gorm()).WithClock(clock.Now)

	router := httpapi.NewRouter(httpapi.Options{
		Store:        authStore,
		BabyStore:    babyStore,
		RecordStore:  recordStore,
		DashboardSvc: dashSvc,
		VaccineStore: vaccineStore,
		DistDir:      distDir,
	})
	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)

	// 禁用客户端自动跟随重定向，使测试能精确断言原始 HTTP 状态码与响应头。
	httpClient := ts.Client()
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}

	app := &TestApp{
		t:      t,
		Clock:  clock,
		Server: ts,
		Router: router,
		db:     db,
		client: &AppClient{
			baseURL:    ts.URL,
			httpClient: httpClient,
			origin:     ts.URL,
		},
	}

	if cfg.autoLogin && cfg.initAdmin {
		resp := app.client.Login(t, defaultAdminUser, defaultAdminPass)
		resp.RequireStatus(t, http.StatusOK)
		cookiePair, ok := resp.CookiePair(auth.SessionCookieName)
		if !ok {
			t.Fatalf("auto login did not return %s cookie: Set-Cookie=%q", auth.SessionCookieName, resp.SetCookieHeader())
		}
		app.client = app.client.WithCookie(cookiePair)
	}

	return app
}

// assertIsolatedTempDir 防呆核验测试目录位于系统临时目录内，杜绝任何路径误触工作区 data/ 目录。
func assertIsolatedTempDir(t *testing.T, tempRoot string) {
	t.Helper()

	resolvedTmp, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		resolvedTmp = filepath.Clean(os.TempDir())
	}
	resolvedRoot, err := filepath.EvalSymlinks(tempRoot)
	if err != nil {
		resolvedRoot = filepath.Clean(tempRoot)
	}
	rel, err := filepath.Rel(resolvedTmp, resolvedRoot)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		t.Fatalf("test temp dir %q must reside within system temp dir %q", resolvedRoot, resolvedTmp)
	}
}

// setupDistFixtures 构造涵盖 4 类缓存策略的最小前端产物（HTML、PWA manifest、SW 与带哈希资源）及越界符号链接。
func setupDistFixtures(t *testing.T, tempRoot string) string {
	t.Helper()

	distDir := filepath.Join(tempRoot, "dist")
	if err := os.MkdirAll(filepath.Join(distDir, "assets"), 0o755); err != nil {
		t.Fatalf("mkdir dist assets: %v", err)
	}
	files := map[string]string{
		filepath.Join(distDir, "index.html"):               "<!doctype html><title>BabyLog Test</title>",
		filepath.Join(distDir, "manifest.webmanifest"):     `{"name":"BabyLog"}`,
		filepath.Join(distDir, "sw.js"):                    "self.addEventListener('fetch', () => {});",
		filepath.Join(distDir, "assets", "app-hash123.js"): "console.log('ok');",
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatalf("write dist fixture %s: %v", path, err)
		}
	}

	// 在 dist 外部写入敏感文件并建立指向它的符号链接，供安全用例验证路径穿越与符号链接逃逸防护。
	outsideFile := filepath.Join(tempRoot, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("top-secret"), 0o600); err != nil {
		t.Fatalf("write outside secret fixture: %v", err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(distDir, "escape.txt")); err != nil {
		t.Fatalf("create escape symlink fixture: %v", err)
	}
	return distDir
}

func (a *TestApp) Client() *AppClient {
	return a.client
}

func (a *TestApp) UnauthenticatedClient() *AppClient {
	return a.client.WithoutCookie()
}

// Scenario 返回绑定当前客户端的场景数据生成器；所有前置业务数据均经真实 HTTP API 创建。
func (a *TestApp) Scenario() *Scenario {
	return &Scenario{
		t:      a.t,
		client: a.client,
	}
}

// readDB 仅在包内为只读回读断言函数提供干净的 GORM 会话，不对外暴露可写数据库句柄。
func (a *TestApp) readDB() *gorm.DB {
	return a.db.Gorm().Session(&gorm.Session{NewDB: true})
}

// CountRows 按 GORM 模型类型 T 统计 SQLite 中满足条件的持久化行数，避免手写表名与误写数据库。
func CountRows[T any](t *testing.T, app *TestApp, where string, args ...any) int64 {
	t.Helper()
	var count int64
	q := app.readDB().Model(new(T))
	if where != "" {
		q = q.Where(where, args...)
	}
	if err := q.Count(&count).Error; err != nil {
		t.Fatalf("count %T rows (%s): %v", *new(T), where, err)
	}
	return count
}

// FirstRow 按 GORM 模型类型 T 从 SQLite 回读单行落库终态（常用于验证可空列清空为 NULL 或事务回滚）。
func FirstRow[T any](t *testing.T, app *TestApp, where string, args ...any) T {
	t.Helper()
	var dest T
	if err := app.readDB().Where(where, args...).First(&dest).Error; err != nil {
		t.Fatalf("read back %T row (%s): %v", dest, where, err)
	}
	return dest
}

// FindRows 按 GORM 模型类型 T 从 SQLite 回读多行落库终态（常用于验证删除重排后的全部兄弟剂次）。
func FindRows[T any](t *testing.T, app *TestApp, orderBy, where string, args ...any) []T {
	t.Helper()
	var rows []T
	q := app.readDB()
	if where != "" {
		q = q.Where(where, args...)
	}
	if orderBy != "" {
		q = q.Order(orderBy)
	}
	if err := q.Find(&rows).Error; err != nil {
		t.Fatalf("find %T rows (%s): %v", *new(T), where, err)
	}
	return rows
}

// AppClient 模拟真实前端 App 向后端发起 HTTP 请求；派生方法均返回新副本，互不污染状态。
type AppClient struct {
	baseURL    string
	httpClient *http.Client
	cookie     string
	origin     string
}

func (c *AppClient) WithCookie(cookiePair string) *AppClient {
	cp := *c
	cp.cookie = cookiePair
	return &cp
}

func (c *AppClient) WithoutCookie() *AppClient {
	cp := *c
	cp.cookie = ""
	return &cp
}

// WithOrigin 返回覆盖 Origin 请求头的新客户端视图；传入空字符串 "" 表示不发送 Origin 请求头。
func (c *AppClient) WithOrigin(origin string) *AppClient {
	cp := *c
	cp.origin = origin
	return &cp
}

// Login 使用当前客户端的 Cookie/Origin 配置经真实 POST /api/auth/login 提交管理员凭据。
// 匿名登录请使用 app.UnauthenticatedClient().Login(...)，会话轮换请使用 app.Client().Login(...)。
func (c *AppClient) Login(t *testing.T, username, password string) *Response {
	t.Helper()
	return c.Post(t, "/api/auth/login", map[string]string{
		"username": username,
		"password": password,
	})
}

func (c *AppClient) Get(t *testing.T, path string) *Response {
	t.Helper()
	return c.doJSON(t, http.MethodGet, path, nil)
}

func (c *AppClient) Post(t *testing.T, path string, body any) *Response {
	t.Helper()
	return c.doJSON(t, http.MethodPost, path, body)
}

func (c *AppClient) Put(t *testing.T, path string, body any) *Response {
	t.Helper()
	return c.doJSON(t, http.MethodPut, path, body)
}

func (c *AppClient) Delete(t *testing.T, path string) *Response {
	t.Helper()
	return c.doJSON(t, http.MethodDelete, path, nil)
}

// DoRaw 发起自定义 Content-Type 与原始字节载荷的请求，用于验证 415、413、400 畸形 JSON 及 405 等边界。
func (c *AppClient) DoRaw(t *testing.T, method, path, contentType string, rawBody []byte) *Response {
	t.Helper()

	var bodyReader io.Reader
	if rawBody != nil {
		bodyReader = bytes.NewReader(rawBody)
	}
	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		t.Fatalf("build %s %s request: %v", method, path, err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	// 非 GET/HEAD 写请求默认自动注入同源 Origin 头，以满足后端 Same-Origin 安全中间件校验。
	if method != http.MethodGet && method != http.MethodHead && c.origin != "" {
		req.Header.Set("Origin", c.origin)
	}
	if c.cookie != "" {
		req.Header.Set("Cookie", c.cookie)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		t.Fatalf("execute %s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s %s response body: %v", method, path, err)
	}
	return &Response{
		Method:     method,
		Path:       path,
		StatusCode: resp.StatusCode,
		Header:     resp.Header.Clone(),
		Cookies:    resp.Cookies(),
		Body:       raw,
	}
}

func (c *AppClient) doJSON(t *testing.T, method, path string, body any) *Response {
	t.Helper()

	if body == nil {
		return c.DoRaw(t, method, path, "", nil)
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal %s %s request body: %v", method, path, err)
	}
	return c.DoRaw(t, method, path, "application/json", raw)
}

// Response 封装已读取完毕的 HTTP 响应快照，避免调用方遗漏关闭 Body 并在断言失败时附带完整上下文。
type Response struct {
	Method     string
	Path       string
	StatusCode int
	Header     http.Header
	Cookies    []*http.Cookie
	Body       []byte
}

func (r *Response) RequireStatus(t *testing.T, want int) {
	t.Helper()
	if r.StatusCode != want {
		t.Fatalf("%s %s: expected HTTP %d, got %d (body=%s)", r.Method, r.Path, want, r.StatusCode, string(r.Body))
	}
}

// RequireError 断言响应状态码与结构化中文 JSON 错误消息；wantSubstr 非空时同时校验错误消息包含该关键字。
func (r *Response) RequireError(t *testing.T, wantStatus int, wantSubstr string) string {
	t.Helper()
	r.RequireStatus(t, wantStatus)

	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(r.Body, &payload); err != nil {
		t.Fatalf("%s %s: decode error JSON failed: %v (body=%s)", r.Method, r.Path, err, string(r.Body))
	}
	if strings.TrimSpace(payload.Error) == "" {
		t.Fatalf("%s %s: expected non-empty error message, got body=%s", r.Method, r.Path, string(r.Body))
	}
	if wantSubstr != "" && !strings.Contains(payload.Error, wantSubstr) {
		t.Fatalf("%s %s: expected error containing %q, got %q", r.Method, r.Path, wantSubstr, payload.Error)
	}
	return payload.Error
}

func (r *Response) SetCookieHeader() string {
	return r.Header.Get("Set-Cookie")
}

// CookiePair 按名称提取 "name=value" 形式的 Cookie 键值对，可直接传给 AppClient.WithCookie。
func (r *Response) CookiePair(name string) (string, bool) {
	for _, ck := range r.Cookies {
		if ck.Name == name {
			return ck.Name + "=" + ck.Value, true
		}
	}
	return "", false
}

// DecodeJSON 将响应体反序列化为目标泛型结构 T，解析失败时立即终止当前用例并附带原始响应体。
func DecodeJSON[T any](t *testing.T, resp *Response) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		t.Fatalf("%s %s: decode JSON into %T failed: %v (body=%s)", resp.Method, resp.Path, out, err, string(resp.Body))
	}
	return out
}
