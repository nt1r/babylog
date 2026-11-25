package main_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/database"
)

var testBinaryPath string

// TestMain 在整个测试包启动前仅编译一次只读二进制，避免多个 CLI/进程用例重复编译。
func TestMain(m *testing.M) {
	tmpDir, err := os.MkdirTemp("", "babylog-cli-bin-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create temp dir failed: %v\n", err)
		os.Exit(1)
	}
	testBinaryPath = filepath.Join(tmpDir, "babylog")
	cmd := exec.Command("go", "build", "-o", testBinaryPath, ".")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if output, buildErr := cmd.CombinedOutput(); buildErr != nil {
		_ = os.RemoveAll(tmpDir)
		fmt.Fprintf(os.Stderr, "build babylog binary failed: %v\n%s\n", buildErr, string(output))
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

func TestAdminInitCLI(t *testing.T) {
	binPath := testBinaryPath

	t.Run("initializes admin stripping single trailing CRLF and rejects duplicate runs", func(t *testing.T) {
		workDir := t.TempDir()
		dataDir := filepath.Join(workDir, "data")
		passwordFile := filepath.Join(workDir, "password.txt")
		if err := os.WriteFile(passwordFile, []byte("  padded-secret-123  \r\n"), 0o600); err != nil {
			t.Fatalf("write password file: %v", err)
		}

		code, stdout, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", passwordFile, "--username", "papa")
		if code != 0 {
			t.Fatalf("expected exit 0, got %d (stderr=%q)", code, stderr)
		}
		if !strings.Contains(stdout, "管理员初始化成功") {
			t.Errorf("unexpected stdout: %q", stdout)
		}

		db, err := database.Open(dataDir)
		if err != nil {
			t.Fatalf("open db: %v", err)
		}
		defer func() { _ = db.Close() }()

		store := auth.NewStore(db.Gorm())
		user, err := store.Authenticate(context.Background(), "papa", "  padded-secret-123  ")
		if err != nil || user == nil || user.Username != "papa" || user.Role != "admin" {
			t.Fatalf("expected authenticated papa, got (%+v, %v)", user, err)
		}

		dupCode, _, dupStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", passwordFile)
		if dupCode == 0 {
			t.Fatal("expected duplicate init to fail")
		}
		if !strings.Contains(dupStderr, "管理员已存在") {
			t.Errorf("unexpected duplicate stderr: %q", dupStderr)
		}
	})

	t.Run("resolves relative password file and data dir via BABYLOG_WORK_DIR", func(t *testing.T) {
		workDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(workDir, "rel-pass.txt"), []byte("relative-path-secret\n"), 0o600); err != nil {
			t.Fatalf("write rel password file: %v", err)
		}

		code, stdout, stderr := runCLIWithEnv(
			binPath,
			[]string{"BABYLOG_WORK_DIR=" + workDir, "BABYLOG_DATA_DIR=./rel-data"},
			"admin", "init", "--password-file", "./rel-pass.txt",
		)
		if code != 0 {
			t.Fatalf("expected exit 0, got %d (stderr=%q)", code, stderr)
		}
		if !strings.Contains(stdout, "管理员初始化成功") {
			t.Errorf("unexpected stdout: %q", stdout)
		}
		if _, err := os.Stat(filepath.Join(workDir, "rel-data", database.DatabaseFileName)); err != nil {
			t.Fatalf("expected sqlite file created under BABYLOG_WORK_DIR/rel-data: %v", err)
		}
	})

	t.Run("rejects short, oversized, directory password files and invalid CLI arguments", func(t *testing.T) {
		workDir := t.TempDir()
		dataDir := filepath.Join(workDir, "data")
		shortFile := filepath.Join(workDir, "short.txt")
		longFile := filepath.Join(workDir, "long.txt")
		if err := os.WriteFile(shortFile, []byte("too-short\n"), 0o600); err != nil {
			t.Fatalf("write short password file: %v", err)
		}
		if err := os.WriteFile(longFile, []byte(strings.Repeat("a", auth.MaxPasswordLength+1)+"\n"), 0o600); err != nil {
			t.Fatalf("write long password file: %v", err)
		}

		shortCode, _, shortStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", shortFile)
		if shortCode == 0 || !strings.Contains(shortStderr, "12 至 1024") {
			t.Errorf("expected short password rejected, got code=%d stderr=%q", shortCode, shortStderr)
		}

		longCode, _, longStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", longFile)
		if longCode == 0 || !strings.Contains(longStderr, "1024") {
			t.Errorf("expected long password rejected, got code=%d stderr=%q", longCode, longStderr)
		}

		dirCode, _, dirStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", workDir)
		if dirCode == 0 || !strings.Contains(dirStderr, "普通文件") {
			t.Errorf("expected directory rejected as password file, got code=%d stderr=%q", dirCode, dirStderr)
		}

		missingCode, _, missingStderr := runCLI(binPath, dataDir, "admin", "init")
		if missingCode == 0 || !strings.Contains(missingStderr, "用法") {
			t.Errorf("expected missing args rejected with Chinese usage, got code=%d stderr=%q", missingCode, missingStderr)
		}

		extraArgCode, _, extraArgStderr := runCLI(binPath, dataDir, "admin", "init", "unexpected-arg", "--password-file", shortFile)
		if extraArgCode == 0 || !strings.Contains(extraArgStderr, "用法") {
			t.Errorf("expected extra positional arg rejected with Chinese usage, got code=%d stderr=%q", extraArgCode, extraArgStderr)
		}
	})

	t.Run("rejects invalid usernames without creating administrator", func(t *testing.T) {
		workDir := t.TempDir()
		dataDir := filepath.Join(workDir, "data")
		validPassFile := filepath.Join(workDir, "valid-pass.txt")
		if err := os.WriteFile(validPassFile, []byte("valid-cli-password-123\n"), 0o600); err != nil {
			t.Fatalf("write valid password file: %v", err)
		}

		for _, badUser := range []string{"", " admin", "admin ", strings.Repeat("a", auth.MaxUsernameLength+1)} {
			code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", validPassFile, "--username", badUser)
			if code == 0 || !strings.Contains(stderr, "用户名") {
				t.Errorf("username %q: expected non-zero exit with Chinese username error, got code=%d stderr=%q", badUser, code, stderr)
			}
		}

		// 校验非法用户名均未落库创建管理员（后续使用合法默认用户名初始化应成功）。
		okCode, _, okStderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", validPassFile)
		if okCode != 0 {
			t.Fatalf("expected clean db after invalid username rejections, got code=%d stderr=%q", okCode, okStderr)
		}
	})
}

func TestServeProcessLifecycle(t *testing.T) {
	binPath := testBinaryPath
	workDir := t.TempDir()
	dataDir := filepath.Join(workDir, "data")
	distDir := filepath.Join(workDir, "dist")
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		t.Fatalf("mkdir dist: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("<!doctype html><title>BabyLog</title>"), 0o644); err != nil {
		t.Fatalf("write index.html: %v", err)
	}

	passwordFile := filepath.Join(workDir, "pass.txt")
	if err := os.WriteFile(passwordFile, []byte("serve-test-password-123\n"), 0o600); err != nil {
		t.Fatalf("write pass file: %v", err)
	}
	if code, _, stderr := runCLI(binPath, dataDir, "admin", "init", "--password-file", passwordFile); code != 0 {
		t.Fatalf("init admin failed: %s", stderr)
	}

	// 启动真实子进程（PORT=0 分配临时端口）验证登录请求与 SIGTERM 优雅退出。
	cmd := exec.Command(binPath, "serve")
	cmd.Env = append(os.Environ(),
		"BABYLOG_DATA_DIR="+dataDir,
		"BABYLOG_DIST_DIR="+distDir,
		"HOST=127.0.0.1",
		"PORT=0",
	)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		t.Fatalf("start serve: %v", err)
	}
	defer func() {
		if cmd.Process != nil && cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
		}
	}()

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
		t.Fatalf("serve startup timed out, stderr=%s", stderrBuf.String())
	}

	loginPayload, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "serve-test-password-123",
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/auth/login", bytes.NewReader(loginPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", baseURL)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST login to live server: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from live server, got %d", resp.StatusCode)
	}

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("send SIGTERM: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case waitErr := <-done:
		if waitErr != nil {
			t.Fatalf("expected clean exit on SIGTERM, got %v (stderr=%s)", waitErr, stderrBuf.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not shut down cleanly within timeout")
	}
}

func TestVersionCLI(t *testing.T) {
	t.Run("outputs default dev metadata via subcommand and flags", func(t *testing.T) {
		const expected = "babylog dev (commit: unknown, built: unknown)"
		for _, args := range [][]string{{"version"}, {"--version"}, {"-v"}} {
			code, stdout, stderr := runCLIWithEnv(testBinaryPath, nil, args...)
			if code != 0 {
				t.Fatalf("args %v expected exit 0, got %d (stderr=%q)", args, code, stderr)
			}
			if strings.TrimSpace(stdout) != expected {
				t.Errorf("args %v expected stdout %q, got %q", args, expected, strings.TrimSpace(stdout))
			}
		}

		extraCode, _, extraStderr := runCLIWithEnv(testBinaryPath, nil, "version", "extra")
		if extraCode == 0 || !strings.Contains(extraStderr, "用法") {
			t.Errorf("expected extra arg rejected with Chinese usage, got code=%d stderr=%q", extraCode, extraStderr)
		}
	})

	t.Run("outputs ldflags-injected release metadata", func(t *testing.T) {
		tmpBin := filepath.Join(t.TempDir(), "babylog-release")
		ldflags := "-X main.version=v0.1.0 -X main.commit=abc1234 -X main.buildDate=2026-11-23T12:00:00Z"
		buildCmd := exec.Command("go", "build", "-ldflags", ldflags, "-o", tmpBin, ".")
		buildCmd.Env = append(os.Environ(), "CGO_ENABLED=0")
		if out, err := buildCmd.CombinedOutput(); err != nil {
			t.Fatalf("build versioned binary failed: %v\n%s", err, string(out))
		}

		const expected = "babylog v0.1.0 (commit: abc1234, built: 2026-11-23T12:00:00Z)"
		for _, args := range [][]string{{"version"}, {"--version"}} {
			code, stdout, stderr := runCLIWithEnv(tmpBin, nil, args...)
			if code != 0 {
				t.Fatalf("args %v expected exit 0, got %d (stderr=%q)", args, code, stderr)
			}
			if strings.TrimSpace(stdout) != expected {
				t.Errorf("args %v expected stdout %q, got %q", args, expected, strings.TrimSpace(stdout))
			}
		}
	})
}
