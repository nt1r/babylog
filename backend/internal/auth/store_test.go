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
	t.Run("validates usernames by length and surrounding whitespace", func(t *testing.T) {
		valid := []string{"admin", strings.Repeat("a", 128)}
		for _, u := range valid {
			if err := auth.ValidateUsername(u); err != nil {
				t.Errorf("expected username %q valid, got %v", u, err)
			}
		}

		invalid := []string{"", " admin", "admin ", strings.Repeat("a", 129)}
		for _, u := range invalid {
			err := auth.ValidateUsername(u)
			var adminErr *auth.AdministratorError
			if !errors.As(err, &adminErr) {
				t.Errorf("expected AdministratorError for username %q, got %v", u, err)
			}
		}
	})

	t.Run("validates passwords between 12 and 1024 characters", func(t *testing.T) {
		if err := auth.ValidatePassword("123456789012"); err != nil {
			t.Errorf("expected 12-char password valid, got %v", err)
		}
		if err := auth.ValidatePassword(strings.Repeat("p", auth.MaxPasswordLength)); err != nil {
			t.Errorf("expected max-length password valid, got %v", err)
		}

		for _, p := range []string{"short-11-ch", strings.Repeat("p", auth.MaxPasswordLength+1)} {
			err := auth.ValidatePassword(p)
			var adminErr *auth.AdministratorError
			if !errors.As(err, &adminErr) {
				t.Errorf("expected AdministratorError for invalid password len=%d, got %v", len(p), err)
			}
		}
	})

	t.Run("recognizes 43-character base64url session tokens only", func(t *testing.T) {
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

func TestStoreLifecycle(t *testing.T) {
	ctx := context.Background()

	t.Run("enforces directory and sqlite file permissions and WAL mode", func(t *testing.T) {
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

	t.Run("initializes once, refuses overwrite, and authenticates credentials", func(t *testing.T) {
		store, _, _ := openTestStore(t)
		const password = "correct-horse-battery-staple"

		user, err := store.Authenticate(ctx, "admin", password)
		if err != nil || user != nil {
			t.Fatalf("expected uninitialized auth=(nil,nil), got (%+v, %v)", user, err)
		}

		if err := store.InitializeAdministrator(ctx, "admin", password); err != nil {
			t.Fatalf("initialize admin: %v", err)
		}

		dupErr := store.InitializeAdministrator(ctx, "other", "another-valid-password")
		var adminErr *auth.AdministratorError
		if !errors.As(dupErr, &adminErr) {
			t.Fatalf("expected AdministratorError on duplicate init, got %v", dupErr)
		}

		user, err = store.Authenticate(ctx, "admin", password)
		if err != nil {
			t.Fatalf("authenticate valid: %v", err)
		}
		if user == nil || user.Username != "admin" || user.Role != "admin" {
			t.Fatalf("unexpected user: %+v", user)
		}

		if badPass, err := store.Authenticate(ctx, "admin", "wrong-password-12345"); err != nil || badPass != nil {
			t.Errorf("expected wrong password rejected, got (%+v, %v)", badPass, err)
		}
		if badUser, err := store.Authenticate(ctx, "other", password); err != nil || badUser != nil {
			t.Errorf("expected wrong username rejected, got (%+v, %v)", badUser, err)
		}
	})

	t.Run("creates, restores, rotates, expires, and revokes SQLite sessions", func(t *testing.T) {
		store, gormDB, _ := openTestStore(t)
		if err := store.InitializeAdministrator(ctx, "dad", "super-secret-password"); err != nil {
			t.Fatalf("initialize admin: %v", err)
		}

		firstToken, err := store.CreateSession(ctx, "")
		if err != nil {
			t.Fatalf("create first session: %v", err)
		}
		if !auth.IsSessionToken(firstToken) {
			t.Fatalf("invalid generated token: %q", firstToken)
		}
		user, err := store.GetSession(ctx, firstToken)
		if err != nil || user == nil || user.Username != "dad" || user.Role != "admin" {
			t.Fatalf("expected session restored for dad, got (%+v, %v)", user, err)
		}

		// 创建新会话时轮换旧令牌。
		secondToken, err := store.CreateSession(ctx, firstToken)
		if err != nil {
			t.Fatalf("rotate session: %v", err)
		}
		if secondToken == firstToken {
			t.Fatal("expected rotated token to differ from previous token")
		}
		if oldUser, err := store.GetSession(ctx, firstToken); err != nil || oldUser != nil {
			t.Errorf("expected rotated-out token invalid, got (%+v, %v)", oldUser, err)
		}
		if newUser, err := store.GetSession(ctx, secondToken); err != nil || newUser == nil || newUser.Username != "dad" {
			t.Errorf("expected new token valid, got (%+v, %v)", newUser, err)
		}

		// 过期会话查询时拒绝并清理记录。
		expiredAt := time.Now().Add(-time.Second).UnixMilli()
		if err := gormDB.Model(&auth.Session{}).Where("token = ?", secondToken).Update("expires_at", expiredAt).Error; err != nil {
			t.Fatalf("expire session: %v", err)
		}
		if expiredUser, err := store.GetSession(ctx, secondToken); err != nil || expiredUser != nil {
			t.Errorf("expected expired token rejected, got (%+v, %v)", expiredUser, err)
		}
		var remaining int64
		if err := gormDB.Model(&auth.Session{}).Where("token = ?", secondToken).Count(&remaining).Error; err != nil {
			t.Fatalf("count expired session: %v", err)
		}
		if remaining != 0 {
			t.Errorf("expected expired session deleted on lookup, count=%d", remaining)
		}

		thirdToken, err := store.CreateSession(ctx, "")
		if err != nil {
			t.Fatalf("create third session: %v", err)
		}
		if err := store.RevokeSession(ctx, thirdToken); err != nil {
			t.Fatalf("revoke session: %v", err)
		}
		if revokedUser, err := store.GetSession(ctx, thirdToken); err != nil || revokedUser != nil {
			t.Errorf("expected revoked token invalid, got (%+v, %v)", revokedUser, err)
		}
	})

	t.Run("authenticates legacy Node.js scrypt password hashes seamlessly", func(t *testing.T) {
		store, gormDB, _ := openTestStore(t)
		legacyAdmin := auth.Administrator{
			ID:           1,
			Username:     "legacy-admin",
			PasswordSalt: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
			PasswordHash: "otZmw0ssSRScpirb/jFqbT0GnQzcFq/M0qn5NijBIUjvBJjU1DA+MJi3L5Vo9sAG+VVazMYm2IZ+GVLxog5mtw==",
		}
		if err := gormDB.Create(&legacyAdmin).Error; err != nil {
			t.Fatalf("seed legacy admin: %v", err)
		}

		user, err := store.Authenticate(ctx, "legacy-admin", "node-compat-secret-123")
		if err != nil {
			t.Fatalf("authenticate legacy admin: %v", err)
		}
		if user == nil || user.Username != "legacy-admin" || user.Role != "admin" {
			t.Fatalf("expected legacy admin authenticated, got %+v", user)
		}
	})
}
