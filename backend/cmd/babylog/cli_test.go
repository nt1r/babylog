package main_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/records"
)

var testBinaryPath string

// lockedBuffer 为子进程 stderr 提供并发安全的字节缓冲，消除超时读取与子进程写入之间的数据竞态。
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// TestMain 在整个测试包启动前仅编译一次只读二进制，避免多个 CLI/进程用例重复编译。
func TestMain(m *testing.M) {
	tmpDir, err := os.MkdirTemp("", "babylog-cli-bin-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "创建临时构建目录失败: %v\n", err)
		os.Exit(1)
	}
	testBinaryPath = filepath.Join(tmpDir, "babylog")
	cmd := exec.Command("go", "build", "-o", testBinaryPath, ".")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if output, buildErr := cmd.CombinedOutput(); buildErr != nil {
		_ = os.RemoveAll(tmpDir)
		fmt.Fprintf(os.Stderr, "编译 babylog 二进制失败: %v\n%s\n", buildErr, string(output))
		os.Exit(1)
	}

	code := m.Run()
	_ = os.RemoveAll(tmpDir)
	os.Exit(code)
}

func runCLIWithEnv(binPath string, extraEnv []string, args ...string) (int, string, string) {
	cmd := exec.Command(binPath, args...)
	cmd.Env = append(os.Environ(), extraEnv...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}
	return exitCode, stdout.String(), stderr.String()
}

func runCLI(binPath, dataDir string, args ...string) (int, string, string) {
	return runCLIWithEnv(binPath, []string{"BABYLOG_DATA_DIR=" + dataDir}, args...)
}

/*
 * Spec: admin-auth / Administrator CLI initialization / Initialize default administrator from password file; Initialize administrator with custom username; Reject duplicate administrator initialization
 * 测试场景：验证真实二进制 `admin init` 支持自定义用户名与默认 `admin` 初始化、仅裁末尾单个 CRLF、解析相对工作目录，并拒绝重复初始化覆盖既有账号。
 * 业务背景：管理员凭据仅允许经本地密码文件初始化，既要完整保留密码首尾空格并支持跨目录脚本（BABYLOG_WORK_DIR），也要守住单管理员不可被二次覆写的底线。
 * 前置数据：
 * - 运行环境：预编译只读 babylog 二进制与独立 t.TempDir() 临时数据目录
 * - 管理员与会话：初始数据库无管理员
 * - 密码文件：含首尾空格与末尾单个 \r\n 的自定义密码文件，以及相对路径默认密码文件
 * 测试目标：
 * 1. 验证指定 --username papa 初始化成功并仅剥离末尾单个 CRLF，落库 scrypt 哈希可通过原带空格密码认证。
 * 2. 验证重复执行 admin init 返回非零退出码并提示已存在，且原有管理员 papa 凭据保持完好未被覆盖。
 * 3. 验证通过 BABYLOG_WORK_DIR 解析相对密码文件与数据目录后，默认用户名 admin 成功落库并通过认证。
 */
func TestCLIAdminInitSuccessAndDuplicateGuard(t *testing.T) {
	binPath := testBinaryPath

	// 1. 自定义用户名初始化：仅剥离文件末尾单个 \r\n，刻意保留密码自身的首尾空格。
	workDir := t.TempDir()
	dataDir := filepath.Join(workDir, "data")
	passwordFile := filepath.Join(workDir, "password.txt")
	if err := os.WriteFile(passwordFile, []byte("  padded-secret-123  \r\n"), 0o600); err != nil {
		t.Fatalf("写入密码文件失败: %v", err)
	}

	code, stdout, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", passwordFile, "--username", "papa")
	if code != 0 {
		t.Fatalf("预期退出码 0，实际 %d (stderr=%q)", code, stderr)
	}
	if !strings.Contains(stdout, "管理员初始化成功") {
		t.Errorf("标准输出缺少中文成功提示：%q", stdout)
	}

	db, err := database.Open(dataDir)
	if err != nil {
		t.Fatalf("打开 SQLite 失败: %v", err)
	}
	defer func() { _ = db.Close() }()

	store := auth.NewStore(db.Gorm())
	user, err := store.Authenticate(context.Background(), "papa", "  padded-secret-123  ")
	if err != nil || user == nil || user.Username != "papa" || user.Role != "admin" {
		t.Fatalf("预期保留空格密码验证通过，实际 (%+v, %v)", user, err)
	}

	// 2. 重复执行 admin init 必须失败，且回查 SQLite 确认原管理员 papa 凭据未被覆盖。
	otherPassFile := filepath.Join(workDir, "other-password.txt")
	if err := os.WriteFile(otherPassFile, []byte("overwrite-attempt-secret\n"), 0o600); err != nil {
		t.Fatalf("写入二次密码文件失败: %v", err)
	}
	dupCode, _, dupStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", otherPassFile)
	if dupCode == 0 {
		t.Fatal("重复初始化管理员必须失败")
	}
	if !strings.Contains(dupStderr, "管理员已存在") {
		t.Errorf("重复初始化错误提示异常：%q", dupStderr)
	}
	stillUser, err := store.Authenticate(context.Background(), "papa", "  padded-secret-123  ")
	if err != nil || stillUser == nil || stillUser.Username != "papa" {
		t.Fatalf("重复初始化失败后原有管理员 papa 应保持完好，实际 (%+v, %v)", stillUser, err)
	}

	// 3. 跨目录相对路径默认用户名初始化：核对基于 BABYLOG_WORK_DIR 建库且默认账号 admin 可通过 scrypt 认证。
	relWorkDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(relWorkDir, "rel-pass.txt"), []byte("relative-path-secret\n"), 0o600); err != nil {
		t.Fatalf("写入相对路径密码文件失败: %v", err)
	}
	relCode, relStdout, relStderr := runCLIWithEnv(
		binPath,
		[]string{"BABYLOG_WORK_DIR=" + relWorkDir, "BABYLOG_DATA_DIR=./rel-data"},
		"admin", "init", "--password-file", "./rel-pass.txt",
	)
	if relCode != 0 || !strings.Contains(relStdout, "管理员初始化成功") {
		t.Fatalf("相对路径初始化默认 admin 失败：code=%d stdout=%q stderr=%q", relCode, relStdout, relStderr)
	}
	relDB, err := database.Open(filepath.Join(relWorkDir, "rel-data"))
	if err != nil {
		t.Fatalf("打开相对路径 SQLite 失败: %v", err)
	}
	defer func() { _ = relDB.Close() }()

	defaultAdmin, err := auth.NewStore(relDB.Gorm()).Authenticate(context.Background(), "admin", "relative-path-secret")
	if err != nil || defaultAdmin == nil || defaultAdmin.Username != "admin" || defaultAdmin.Role != "admin" {
		t.Fatalf("默认用户名 admin 初始化后认证失败：(%+v, %v)", defaultAdmin, err)
	}
}

/*
 * Spec: admin-auth / Administrator CLI initialization / Reject invalid password length
 * 测试场景：验证 `admin init` 拒绝过短/超长密码、目录路径、非法 CLI 参数与非法用户名，且全部拒绝后 SQLite 零管理员落库。
 * 业务背景：管理员初始化入口直接写入核心鉴权凭据，必须拦死弱口令、超长异常输入、错误文件类型与非法用户名，并确保失败不留半成品数据。
 * 前置数据：
 * - 运行环境：预编译只读 babylog 二进制与独立 t.TempDir() 临时数据目录
 * - 管理员与会话：初始数据库无管理员
 * - 密码文件：过短（9 字符）、超长（1025 字符）与合法密码文件各一份
 * 测试目标：
 * 1. 验证过短/超长密码、目录路径及缺少/多余参数均返回非零退出码和中文提示，且未落库任何管理员记录。
 * 2. 验证空字符串、含首尾空格与超长用户名均返回非零退出码和中文提示，且随后使用合法默认参数仍可干净完成初始化。
 */
func TestCLIAdminInitInvalidPasswordAndArgsGuards(t *testing.T) {
	binPath := testBinaryPath
	workDir := t.TempDir()
	dataDir := filepath.Join(workDir, "data")

	shortFile := filepath.Join(workDir, "short.txt")
	longFile := filepath.Join(workDir, "long.txt")
	validPassFile := filepath.Join(workDir, "valid-pass.txt")
	if err := os.WriteFile(shortFile, []byte("too-short\n"), 0o600); err != nil {
		t.Fatalf("写入过短密码文件失败: %v", err)
	}
	if err := os.WriteFile(longFile, []byte(strings.Repeat("a", auth.MaxPasswordLength+1)+"\n"), 0o600); err != nil {
		t.Fatalf("写入超长密码文件失败: %v", err)
	}
	if err := os.WriteFile(validPassFile, []byte("valid-cli-password-123\n"), 0o600); err != nil {
		t.Fatalf("写入合法密码文件失败: %v", err)
	}

	// 1. 非法密码长度、目录路径与非法参数均返回非零退出码，且 SQLite 保持零管理员。
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", shortFile); code == 0 || !strings.Contains(stderr, "12 至 1024") {
		t.Errorf("过短密码未被正确拒绝：code=%d stderr=%q", code, stderr)
	}
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", longFile); code == 0 || !strings.Contains(stderr, "1024") {
		t.Errorf("超长密码未被正确拒绝：code=%d stderr=%q", code, stderr)
	}
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", workDir); code == 0 || !strings.Contains(stderr, "普通文件") {
		t.Errorf("目录路径作为密码文件未被拒绝：code=%d stderr=%q", code, stderr)
	}
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init"); code == 0 || !strings.Contains(stderr, "用法") {
		t.Errorf("缺少参数未输出中文用法提示：code=%d stderr=%q", code, stderr)
	}
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "unexpected-arg", "--password-file", shortFile); code == 0 || !strings.Contains(stderr, "用法") {
		t.Errorf("多余位置参数未输出中文用法提示：code=%d stderr=%q", code, stderr)
	}
	if _, err := os.Stat(filepath.Join(dataDir, database.DatabaseFileName)); err == nil {
		db, openErr := database.Open(dataDir)
		if openErr != nil {
			t.Fatalf("校验零落库时打开 SQLite 失败: %v", openErr)
		}
		var adminCount int64
		if countErr := db.Gorm().Model(&auth.Administrator{}).Count(&adminCount).Error; countErr != nil {
			_ = db.Close()
			t.Fatalf("统计管理员行数失败: %v", countErr)
		}
		_ = db.Close()
		if adminCount != 0 {
			t.Fatalf("非法密码与参数被拒后不应落库管理员，实际 %d", adminCount)
		}
	}

	// 2. 拒绝非法用户名并确认未污染数据库（随后默认合法初始化应成功）。
	for _, badUser := range []string{"", " admin", "admin ", strings.Repeat("a", auth.MaxUsernameLength+1)} {
		code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", validPassFile, "--username", badUser)
		if code == 0 || !strings.Contains(stderr, "用户名") {
			t.Errorf("非法用户名 %q 预期拒绝并提示用户名错误：code=%d stderr=%q", badUser, code, stderr)
		}
	}
	if okCode, _, okStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", validPassFile); okCode != 0 {
		t.Fatalf("非法用户名拒绝后数据库应保持干净，默认初始化失败：code=%d stderr=%q", okCode, okStderr)
	}
}

// startServeProcess 启动真实 babylog serve 子进程，返回监听基地址与线程安全的优雅停止回调。
func startServeProcess(t *testing.T, binPath, dataDir, distDir string) (string, func()) {
	t.Helper()

	cmd := exec.Command(binPath, "serve")
	cmd.Env = append(os.Environ(),
		"BABYLOG_DATA_DIR="+dataDir,
		"BABYLOG_DIST_DIR="+distDir,
		"HOST=127.0.0.1",
		"PORT=0",
	)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("获取子进程 stdout 管道失败: %v", err)
	}
	stderrBuf := &lockedBuffer{}
	cmd.Stderr = stderrBuf

	if err := cmd.Start(); err != nil {
		t.Fatalf("启动 serve 子进程失败: %v", err)
	}

	// 由唯一后台协程负责 cmd.Wait() 并通过 done channel 广播退出结果，彻底避免 t.Cleanup 与 stop 并发读取 ProcessState。
	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()

	var stopOnce sync.Once
	var waitErr error
	exited := false
	var exitMu sync.Mutex

	t.Cleanup(func() {
		exitMu.Lock()
		alreadyExited := exited
		exitMu.Unlock()
		if !alreadyExited && cmd.Process != nil {
			_ = cmd.Process.Kill()
			<-waitCh
		}
	})

	urlCh := make(chan string, 1)
	urlRegex := regexp.MustCompile(`http://127\.0\.0\.1:\d+`)
	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		for scanner.Scan() {
			if match := urlRegex.FindString(scanner.Text()); match != "" {
				urlCh <- match
				return
			}
		}
	}()

	var baseURL string
	select {
	case baseURL = <-urlCh:
	case <-time.After(5 * time.Second):
		t.Fatalf("serve 启动监听超时，stderr=%s", stderrBuf.String())
	}

	stop := func() {
		t.Helper()
		stopOnce.Do(func() {
			if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatalf("发送 SIGTERM 失败: %v", err)
			}
			select {
			case waitErr = <-waitCh:
				exitMu.Lock()
				exited = true
				exitMu.Unlock()
			case <-time.After(5 * time.Second):
				t.Fatal("服务未在超时时间内完成优雅退出")
			}
		})
		if waitErr != nil {
			t.Fatalf("SIGTERM 后预期正常退出，实际 %v (stderr=%s)", waitErr, stderrBuf.String())
		}
	}
	return baseURL, stop
}

// doLiveJSONRequest 向真实运行中的子进程发起带同源 Origin 与可选 Cookie 的 JSON 请求。
func doLiveJSONRequest(t *testing.T, method, baseURL, path, cookie string, payload any) (*http.Response, []byte) {
	t.Helper()

	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("序列化请求体失败: %v", err)
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, baseURL+path, body)
	if err != nil {
		t.Fatalf("构造 %s %s 请求失败: %v", method, path, err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		// 写接口受 Same-Origin 中间件校验，须携带与监听地址一致的 Origin 头。
		req.Header.Set("Origin", baseURL)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求真实进程 %s %s 失败: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("读取响应体失败: %v", err)
	}
	return resp, rawBody
}

/*
 * 范围：基础设施（无对应 OpenSpec 规格）
 * 测试场景：真实进程启动监听、登录建档写入记录、SIGTERM 优雅退出并复用同一数据目录重启后回读数据持久完好。
 * 业务背景：验证真实编译二进制在容器或宿主机重启场景下 SQLite WAL 落盘、会话持久化与优雅停机均无数据丢失。
 * 前置数据：
 * - 运行环境：预编译只读 babylog 二进制、独立临时 BABYLOG_DATA_DIR 与最小 index.html 产物
 * - 管理员与会话：经 CLI 初始化默认管理员（admin）
 * - 宝宝档案：步骤 1 使用相对当前时钟 3 个月前的出生日期建档（不依赖固定宿主机年份）
 * 测试目标：
 * 1. 验证首次启动 serve 进程可完成登录、建档与写入 125ml 配方奶记录，并在收到 SIGTERM 后退出码为 0 优雅停机。
 * 2. 验证复用同一 BABYLOG_DATA_DIR 重启新进程后，原会话 Cookie 依然有效且宝宝档案与喂养记录完整回读。
 */
func TestCLIServeRestartPersistenceLifecycle(t *testing.T) {
	binPath := testBinaryPath
	workDir := t.TempDir()
	dataDir := filepath.Join(workDir, "data")
	distDir := filepath.Join(workDir, "dist")
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		t.Fatalf("创建临时 dist 目录失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("<!doctype html><title>BabyLog</title>"), 0o644); err != nil {
		t.Fatalf("写入临时 index.html 失败: %v", err)
	}

	passwordFile := filepath.Join(workDir, "pass.txt")
	if err := os.WriteFile(passwordFile, []byte("serve-test-password-123\n"), 0o600); err != nil {
		t.Fatalf("写入密码文件失败: %v", err)
	}
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", passwordFile); code != 0 {
		t.Fatalf("初始化管理员失败: %s", stderr)
	}

	// 1. 首次启动真实子进程：使用相对宿主机当前时间的过去出生日建档并写入 125ml 配方奶，再 SIGTERM 优雅退出。
	baseURL1, stop1 := startServeProcess(t, binPath, dataDir, distDir)
	loginResp, loginBody := doLiveJSONRequest(t, http.MethodPost, baseURL1, "/api/auth/login", "", map[string]string{
		"username": "admin",
		"password": "serve-test-password-123",
	})
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("首次启动登录失败：status=%d body=%s", loginResp.StatusCode, string(loginBody))
	}
	var sessionCookie string
	for _, ck := range loginResp.Cookies() {
		if ck.Name == auth.SessionCookieName {
			sessionCookie = ck.Name + "=" + ck.Value
		}
	}
	if sessionCookie == "" {
		t.Fatalf("登录响应缺少 %s 会话 Cookie", auth.SessionCookieName)
	}

	safeBirthDate := time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")
	babyResp, babyBody := doLiveJSONRequest(t, http.MethodPost, baseURL1, "/api/baby?tz=Asia/Shanghai", sessionCookie, baby.UpsertInput{
		Nickname:  "重启宝",
		BirthDate: safeBirthDate,
		Gender:    "female",
	})
	if babyResp.StatusCode != http.StatusCreated {
		t.Fatalf("真实进程建档失败：status=%d body=%s", babyResp.StatusCode, string(babyBody))
	}

	amount := 125
	feedResp, feedBody := doLiveJSONRequest(t, http.MethodPost, baseURL1, "/api/records/feeding", sessionCookie, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   &amount,
		RecordedAt: time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339),
	})
	if feedResp.StatusCode != http.StatusCreated {
		t.Fatalf("真实进程写入喂养记录失败：status=%d body=%s", feedResp.StatusCode, string(feedBody))
	}
	stop1()

	// 2. 复用同一 BABYLOG_DATA_DIR 重启新进程：验证原会话依然有效，且宝宝档案与喂养记录完整持久化。
	baseURL2, stop2 := startServeProcess(t, binPath, dataDir, distDir)
	defer stop2()

	getBabyResp, getBabyBody := doLiveJSONRequest(t, http.MethodGet, baseURL2, "/api/baby", sessionCookie, nil)
	if getBabyResp.StatusCode != http.StatusOK {
		t.Fatalf("重启后携带原会话回读宝宝档案失败：status=%d body=%s", getBabyResp.StatusCode, string(getBabyBody))
	}
	var babyPayload struct {
		Baby *baby.Profile `json:"baby"`
	}
	if err := json.Unmarshal(getBabyBody, &babyPayload); err != nil || babyPayload.Baby == nil || babyPayload.Baby.Nickname != "重启宝" {
		t.Fatalf("重启后回读宝宝档案内容异常：err=%v body=%s", err, string(getBabyBody))
	}

	listFeedResp, listFeedBody := doLiveJSONRequest(t, http.MethodGet, baseURL2, "/api/records/feeding?range=all&tz=Asia/Shanghai", sessionCookie, nil)
	if listFeedResp.StatusCode != http.StatusOK {
		t.Fatalf("重启后回读喂养列表失败：status=%d body=%s", listFeedResp.StatusCode, string(listFeedBody))
	}
	var listPayload records.ListResult[records.FeedingRecord, records.FeedingDailySummary]
	if err := json.Unmarshal(listFeedBody, &listPayload); err != nil || listPayload.Total != 1 ||
		len(listPayload.Items) != 1 || listPayload.Items[0].AmountML == nil || *listPayload.Items[0].AmountML != 125 {
		t.Fatalf("重启后喂养记录未持久保留：err=%v body=%s", err, string(listFeedBody))
	}
}

/*
 * 范围：基础设施（无对应 OpenSpec 规格）
 * 测试场景：验证开发态默认版本输出、多余参数用法拦截与编译期 `-ldflags` 注入的发布版版本元数据。
 * 业务背景：运维排查线上单二进制版本依赖 `babylog version/--version/-v` 准确输出版本号、提交哈希与构建时间。
 * 前置数据：
 * - 运行环境：预编译开发态只读二进制，以及步骤 2 现场通过 `-ldflags` 编译的发布态临时二进制
 * - 管理员与会话：无
 * 测试目标：
 * 1. 验证开发态二进制执行 version/--version/-v 均输出默认开发版本信息，携带多余参数时返回非零并输出中文用法。
 * 2. 验证经 `-ldflags "-X main.version=..."` 编译出的二进制正确输出发布版本号、提交哈希与构建时间。
 */
func TestCLIVersionMetadata(t *testing.T) {
	// 1. 开发态默认版本输出与非法多余参数校验。
	const expectedDev = "babylog dev (commit: unknown, built: unknown)"
	for _, args := range [][]string{{"version"}, {"--version"}, {"-v"}} {
		code, stdout, stderr := runCLIWithEnv(testBinaryPath, nil, args...)
		if code != 0 {
			t.Fatalf("参数 %v 预期退出码 0，实际 %d (stderr=%q)", args, code, stderr)
		}
		if strings.TrimSpace(stdout) != expectedDev {
			t.Errorf("参数 %v 预期输出 %q，实际 %q", args, expectedDev, strings.TrimSpace(stdout))
		}
	}
	extraCode, _, extraStderr := runCLIWithEnv(testBinaryPath, nil, "version", "extra")
	if extraCode == 0 || !strings.Contains(extraStderr, "用法") {
		t.Errorf("多余参数预期输出中文用法错误：code=%d stderr=%q", extraCode, extraStderr)
	}

	// 2. 验证 Go 编译期链接标志 -ldflags "-X" 注入发布版本元数据的行为。
	tmpBin := filepath.Join(t.TempDir(), "babylog-release")
	ldflags := "-X main.version=v0.1.0 -X main.commit=abc1234 -X main.buildDate=2026-11-23T12:00:00Z"
	buildCmd := exec.Command("go", "build", "-ldflags", ldflags, "-o", tmpBin, ".")
	buildCmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("编译带版本元数据二进制失败: %v\n%s", err, string(out))
	}

	const expectedRelease = "babylog v0.1.0 (commit: abc1234, built: 2026-11-23T12:00:00Z)"
	for _, args := range [][]string{{"version"}, {"--version"}} {
		code, stdout, stderr := runCLIWithEnv(tmpBin, nil, args...)
		if code != 0 {
			t.Fatalf("参数 %v 预期退出码 0，实际 %d (stderr=%q)", args, code, stderr)
		}
		if strings.TrimSpace(stdout) != expectedRelease {
			t.Errorf("参数 %v 预期输出 %q，实际 %q", args, expectedRelease, strings.TrimSpace(stdout))
		}
	}
}
