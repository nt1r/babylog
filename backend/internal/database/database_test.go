package database_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/pressly/goose/v3"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/database/migrations"
)

func TestMultiUserMigrationAndSingleAdminConstraint(t *testing.T) {
	t.Run("空库升级至v5后外键启用且部分唯一索引拒绝第二个管理员", func(t *testing.T) {
		dataDir := filepath.Join(t.TempDir(), "empty-data")
		db, err := database.Open(dataDir)
		if err != nil {
			t.Fatalf("打开空库并执行迁移失败: %v", err)
		}
		defer func() { _ = db.Close() }()

		var fkEnabled int
		if err := db.Gorm().Raw("PRAGMA foreign_keys;").Scan(&fkEnabled).Error; err != nil {
			t.Fatalf("查询 foreign_keys 失败: %v", err)
		}
		if fkEnabled != 1 {
			t.Fatalf("期望迁移后 foreign_keys=1，实际为 %d", fkEnabled)
		}

		insertAdmin := `
			INSERT INTO users (username, username_normalized, password_salt, password_hash, role, disabled, must_change_password, created_at, updated_at)
			VALUES (?, ?, 'salt', 'hash', 'admin', 0, 0, '2026-11-25T00:00:00Z', '2026-11-25T00:00:00Z')
		`
		if err := db.Gorm().Exec(insertAdmin, "AdminOne", "adminone").Error; err != nil {
			t.Fatalf("写入首个管理员失败: %v", err)
		}
		if err := db.Gorm().Exec(insertAdmin, "AdminTwo", "admintwo").Error; err == nil {
			t.Fatalf("期望部分唯一索引拒绝第二个 admin，但写入成功")
		}
	})

	t.Run("存量v4数据库无损升级至v5并保留会话宝宝与五张子表外键完整", func(t *testing.T) {
		dataDir := filepath.Join(t.TempDir(), "legacy-v4")
		dbPath := filepath.Join(dataDir, database.DatabaseFileName)

		if err := initV4Database(t, dataDir, dbPath); err != nil {
			t.Fatalf("初始化 v4 测试库失败: %v", err)
		}

		db, err := database.Open(dataDir)
		if err != nil {
			t.Fatalf("v4 升级至 v5 失败: %v", err)
		}
		defer func() { _ = db.Close() }()

		var fkEnabled int
		if err := db.Gorm().Raw("PRAGMA foreign_keys;").Scan(&fkEnabled).Error; err != nil {
			t.Fatalf("查询 foreign_keys 失败: %v", err)
		}
		if fkEnabled != 1 {
			t.Fatalf("期望升级后 foreign_keys=1，实际为 %d", fkEnabled)
		}

		var fkViolations []map[string]any
		if err := db.Gorm().Raw("PRAGMA foreign_key_check;").Scan(&fkViolations).Error; err != nil {
			t.Fatalf("执行 foreign_key_check 失败: %v", err)
		}
		if len(fkViolations) > 0 {
			t.Fatalf("升级后检测到外键违规: %+v", fkViolations)
		}

		var userRow struct {
			ID                 int64
			Username           string
			UsernameNormalized string
			Role               string
			Disabled           int
			MustChangePassword int
		}
		if err := db.Gorm().Raw(`SELECT id, username, username_normalized, role, disabled, must_change_password FROM users WHERE id = 1`).Scan(&userRow).Error; err != nil {
			t.Fatalf("回读迁移后 users 失败: %v", err)
		}
		if userRow.ID != 1 || userRow.Username != "LegacyAdmin" || userRow.UsernameNormalized != "legacyadmin" ||
			userRow.Role != "admin" || userRow.Disabled != 0 || userRow.MustChangePassword != 0 {
			t.Fatalf("迁移后管理员字段不符合预期: %+v", userRow)
		}

		var sessionUserID int64
		if err := db.Gorm().Raw(`SELECT user_id FROM sessions WHERE token = ?`, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").Scan(&sessionUserID).Error; err != nil {
			t.Fatalf("回读迁移后 sessions 失败: %v", err)
		}
		if sessionUserID != 1 {
			t.Fatalf("期望迁移后会话归属 user_id=1，实际为 %d", sessionUserID)
		}

		var babyUserID int64
		var defaultClinic string
		if err := db.Gorm().Raw(`SELECT user_id, default_clinic_name FROM baby_profiles WHERE id = 1`).Row().Scan(&babyUserID, &defaultClinic); err != nil {
			t.Fatalf("回读迁移后 baby_profiles 失败: %v", err)
		}
		if babyUserID != 1 || defaultClinic != "社区卫生服务中心" {
			t.Fatalf("迁移后宝宝档案不符合预期: user_id=%d clinic=%q", babyUserID, defaultClinic)
		}

		for _, tbl := range []string{"feeding_records", "sleep_records", "care_records", "health_records", "vaccine_doses"} {
			var cnt int64
			if err := db.Gorm().Raw("SELECT COUNT(*) FROM " + tbl + " WHERE baby_id = 1").Scan(&cnt).Error; err != nil {
				t.Fatalf("统计子表 %s 失败: %v", tbl, err)
			}
			if cnt != 1 {
				t.Fatalf("期望子表 %s 保留 1 条记录，实际为 %d", tbl, cnt)
			}
		}
	})
}

func initV4Database(t *testing.T, dataDir, dbPath string) error {
	t.Helper()
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	gormDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return err
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return err
	}
	defer func() { _ = sqlDB.Close() }()

	if _, err := sqlDB.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, migrations.FS)
	if err != nil {
		return err
	}
	if _, err := provider.UpTo(context.Background(), 4); err != nil {
		return err
	}

	seedStmts := []string{
		`INSERT INTO administrator (id, username, password_salt, password_hash) VALUES (1, 'LegacyAdmin', 'salt', 'hash')`,
		`INSERT INTO sessions (token, administrator_id, expires_at) VALUES ('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 1, 9999999999999)`,
		`INSERT INTO baby_profiles (id, nickname, birth_date, gender, default_clinic_name, created_at, updated_at) VALUES (1, '小汤圆', '2026-07-15', 'female', '社区卫生服务中心', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
		`INSERT INTO feeding_records (baby_id, subtype, amount_ml, recorded_at, note, created_at, updated_at) VALUES (1, 'formula', 120, '2026-11-20T01:00:00Z', '', '2026-11-20T01:00:00Z', '2026-11-20T01:00:00Z')`,
		`INSERT INTO sleep_records (baby_id, subtype, started_at, ended_at, duration_min, note, created_at, updated_at) VALUES (1, 'nap', '2026-11-20T02:00:00Z', '2026-11-20T03:00:00Z', 60, '', '2026-11-20T02:00:00Z', '2026-11-20T02:00:00Z')`,
		`INSERT INTO care_records (baby_id, subtype, diaper_kind, recorded_at, note, created_at, updated_at) VALUES (1, 'diaper', 'pee', '2026-11-20T04:00:00Z', '', '2026-11-20T04:00:00Z', '2026-11-20T04:00:00Z')`,
		`INSERT INTO health_records (baby_id, subtype, temperature_c, recorded_at, note, created_at, updated_at) VALUES (1, 'temperature', 36.8, '2026-11-20T05:00:00Z', '', '2026-11-20T05:00:00Z', '2026-11-20T05:00:00Z')`,
		`INSERT INTO vaccine_doses (baby_id, template_code, dose_number, total_doses, vaccine_name, category, age_months, age_label, status, created_at, updated_at) VALUES (1, 'hepb', 1, 3, '乙肝疫苗', 'nip', 0, '出生时', 'pending', '2026-11-20T06:00:00Z', '2026-11-20T06:00:00Z')`,
	}
	for _, stmt := range seedStmts {
		if _, err := sqlDB.Exec(stmt); err != nil {
			return err
		}
	}
	return sqlDB.Ping()
}
