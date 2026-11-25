package auth_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

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

func TestStoreInfrastructureAndLegacyCompat(t *testing.T) {
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
