package auth_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/database"
)

func openTestStore(t *testing.T) (*auth.Store, *gorm.DB, string) {
	t.Helper()
	dataDir := filepath.Join(t.TempDir(), "data")
	db, err := database.Open(dataDir)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return auth.NewStore(db.Gorm()), db.Gorm(), dataDir
}

func TestValidators(t *testing.T) {
	t.Run("按长度与首尾空白校验用户名", func(t *testing.T) {
		valid := []string{"admin", strings.Repeat("a", 128)}
		for _, u := range valid {
			if err := auth.ValidateUsername(u); err != nil {
				t.Errorf("expected username %q valid, got %v", u, err)
			}
		}

		invalid := []string{"", " admin", "admin ", strings.Repeat("a", 129)}
		for _, u := range invalid {
			err := auth.ValidateUsername(u)
			var valErr *auth.ValidationError
			if !errors.As(err, &valErr) {
				t.Errorf("expected ValidationError for username %q, got %v", u, err)
			}
		}
	})

	t.Run("校验12至1024字符密码边界", func(t *testing.T) {
		if err := auth.ValidatePassword("123456789012"); err != nil {
			t.Errorf("expected 12-char password valid, got %v", err)
		}
		if err := auth.ValidatePassword(strings.Repeat("p", auth.MaxPasswordLength)); err != nil {
			t.Errorf("expected max-length password valid, got %v", err)
		}

		for _, p := range []string{"short-11-ch", strings.Repeat("p", auth.MaxPasswordLength+1)} {
			err := auth.ValidatePassword(p)
			var valErr *auth.ValidationError
			if !errors.As(err, &valErr) {
				t.Errorf("expected ValidationError for invalid password len=%d, got %v", len(p), err)
			}
		}
	})

	// 32 字节（256 bit）随机令牌经无填充 base64url 编码后固定为 43 个字符。
	t.Run("仅放行43位base64url会话令牌", func(t *testing.T) {
		if !auth.IsSessionToken(strings.Repeat("A", 43)) {
			t.Error("expected 43 A's valid")
		}
		if !auth.IsSessionToken(strings.Repeat("aZ09_-", 7) + "x") {
			t.Error("expected 43 base64url chars valid")
		}
		invalid := []string{
			"",
			strings.Repeat("A", 42),
			strings.Repeat("A", 44),
			strings.Repeat("A", 42) + "+",
		}
		for _, tok := range invalid {
			if auth.IsSessionToken(tok) {
				t.Errorf("expected token %q invalid", tok)
			}
		}
	})
}

func TestStoreInfrastructureAndLegacyCompat(t *testing.T) {
	ctx := context.Background()

	// 验证 HTTP 层无法直接表达的底层持久化不变量：目录 0700、SQLite 文件 0600 及 WAL 日志模式。
	t.Run("校验数据目录与SQLite文件权限及WAL模式", func(t *testing.T) {
		_, gormDB, dataDir := openTestStore(t)

		dirInfo, err := os.Stat(dataDir)
		if err != nil {
			t.Fatalf("stat dataDir: %v", err)
		}
		if perm := dirInfo.Mode().Perm(); perm != 0o700 {
			t.Errorf("expected data dir perm 0700, got %04o", perm)
		}

		dbInfo, err := os.Stat(filepath.Join(dataDir, database.DatabaseFileName))
		if err != nil {
			t.Fatalf("stat db file: %v", err)
		}
		if perm := dbInfo.Mode().Perm(); perm != 0o600 {
			t.Errorf("expected db file perm 0600, got %04o", perm)
		}

		var journalMode string
		if err := gormDB.Raw("PRAGMA journal_mode;").Scan(&journalMode).Error; err != nil {
			t.Fatalf("query journal_mode: %v", err)
		}
		if !strings.EqualFold(journalMode, "wal") {
			t.Errorf("expected WAL journal_mode, got %q", journalMode)
		}
	})

	// 兼容性专项：该向量由旧版 Node.js crypto.scryptSync("node-compat-secret-123", salt, 64) 生成（N=16384, r=8, p=1），
	// 须绕过 InitializeAdministrator 直接写库，以验证 Go 实现与存量 SQLite 数据无缝兼容。
	t.Run("无缝兼容旧版Node.js_scrypt密码哈希", func(t *testing.T) {
		store, gormDB, _ := openTestStore(t)
		legacyAdmin := auth.User{
			Username:           "legacy-admin",
			UsernameNormalized: "legacy-admin",
			PasswordSalt:       "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
			PasswordHash:       "otZmw0ssSRScpirb/jFqbT0GnQzcFq/M0qn5NijBIUjvBJjU1DA+MJi3L5Vo9sAG+VVazMYm2IZ+GVLxog5mtw==",
			Role:               auth.RoleAdmin,
			CreatedAt:          "2026-11-25T00:00:00Z",
			UpdatedAt:          "2026-11-25T00:00:00Z",
		}
		if err := gormDB.Create(&legacyAdmin).Error; err != nil {
			t.Fatalf("seed legacy admin: %v", err)
		}

		user, err := store.Authenticate(ctx, "LEGACY-ADMIN", "node-compat-secret-123")
		if err != nil {
			t.Fatalf("authenticate legacy admin: %v", err)
		}
		if user == nil || user.Username != "legacy-admin" || user.Role != auth.RoleAdmin {
			t.Fatalf("expected legacy admin authenticated, got %+v", user)
		}
	})

	// 校验 Store.Login 外部接口：限流窗口与会话过期共用 WithClock，且停用账号密码正确时返回 ErrUserDisabled 不计入失败。
	t.Run("Login统一收口限流时钟同步与停用用户语义", func(t *testing.T) {
		now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
		store, _, _ := openTestStore(t)
		store.WithClock(func() time.Time { return now })

		if err := store.InitializeAdministrator(ctx, "admin", "admin-secret-123"); err != nil {
			t.Fatalf("init admin: %v", err)
		}
		alice, err := store.CreateUser(ctx, "Alice", "alice-secret-123", false)
		if err != nil {
			t.Fatalf("create alice: %v", err)
		}
		if _, err := store.SetUserDisabledByID(ctx, alice.ID, true); err != nil {
			t.Fatalf("disable alice: %v", err)
		}

		// 停用用户提交正确密码返回 ErrUserDisabled，且连续 11 次不会触发限流。
		for i := 0; i < 11; i++ {
			if _, _, err := store.Login(ctx, "ALICE", "alice-secret-123", ""); !errors.Is(err, auth.ErrUserDisabled) {
				t.Fatalf("停用用户第 %d 次正确密码登录预期 ErrUserDisabled，实际 %v", i+1, err)
			}
		}

		// 连续 10 次错误密码触发限流，第 11 次即使密码正确也返回 ErrRateLimited。
		for i := 0; i < 10; i++ {
			if _, _, err := store.Login(ctx, "Admin", "wrong-secret-000", ""); !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("第 %d 次错误密码预期 ErrInvalidCredentials，实际 %v", i+1, err)
			}
		}
		if _, _, err := store.Login(ctx, "ADMIN", "admin-secret-123", ""); !errors.Is(err, auth.ErrRateLimited) {
			t.Fatalf("第 11 次登录预期 ErrRateLimited，实际 %v", err)
		}

		// 推进 WithClock 满 15 分钟后自动解限并签发有效会话，同时清零失败计数。
		now = now.Add(15 * time.Minute)
		user, token, err := store.Login(ctx, "admin", "admin-secret-123", "")
		if err != nil || user == nil || !auth.IsSessionToken(token) {
			t.Fatalf("15 分钟窗口滑出后登录应成功，实际 user=%+v tokenLen=%d err=%v", user, len(token), err)
		}
		restored, err := store.GetSession(ctx, token)
		if err != nil || restored == nil || restored.ID != user.ID {
			t.Fatalf("新签发会话应可正常恢复，实际 restored=%+v err=%v", restored, err)
		}
	})
}
