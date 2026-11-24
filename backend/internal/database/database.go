// Package database 封装零 CGO SQLite 的打开、安全权限基线、WAL 参数配置与内嵌 goose 迁移执行。
package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/glebarez/sqlite"
	"github.com/pressly/goose/v3"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/nt1r/babylog/backend/internal/database/migrations"
)

// DatabaseFileName 为 SQLite 主数据库文件名。
const DatabaseFileName = "babylog.sqlite"

// sqlitePragmas 统一定义连接初始化所需的 PRAGMA 参数，避免 DSN 与校验逻辑分叉。
var sqlitePragmas = []struct {
	name  string
	value string
}{
	{name: "busy_timeout", value: "5000"},
	{name: "foreign_keys", value: "1"},
	{name: "journal_mode", value: "WAL"},
	{name: "synchronous", value: "NORMAL"},
}

// DB 封装 GORM 实例与底层 sql.DB，统一管理数据库生命周期。
type DB struct {
	gormDB *gorm.DB
	sqlDB  *sql.DB
}

// Gorm 返回可用于业务查询与事务的 GORM 实例。
func (d *DB) Gorm() *gorm.DB {
	return d.gormDB
}

// Close 关闭底层 SQLite 数据库连接。
func (d *DB) Close() error {
	if d == nil || d.sqlDB == nil {
		return nil
	}
	return d.sqlDB.Close()
}

// Open 初始化数据目录权限（0700）、SQLite 文件权限（0600）、WAL 连接参数，并执行内嵌 goose 迁移。
// 任意后续初始化步骤失败时会自动关闭已打开的连接句柄，避免文件描述符泄漏。
func Open(dataDir string) (*DB, error) {
	// 1. 创建数据目录并显式 Chmod 0700（仅当前用户可读写进入），抵消进程 umask 或已有宽松权限影响。
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	if err := os.Chmod(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("设置数据目录权限失败: %w", err)
	}

	// 2. 预先以 0600 权限创建/收紧 SQLite 文件，避免数据库以默认全局可读权限落盘。
	dbPath := filepath.Join(dataDir, DatabaseFileName)
	file, err := os.OpenFile(dbPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return nil, fmt.Errorf("打开数据库文件失败: %w", err)
	}
	if closeErr := file.Close(); closeErr != nil {
		return nil, fmt.Errorf("关闭数据库文件句柄失败: %w", closeErr)
	}
	if err := os.Chmod(dbPath, 0o600); err != nil {
		return nil, fmt.Errorf("设置数据库文件权限失败: %w", err)
	}

	// 3. 通过纯 Go SQLite 驱动（glebarez/sqlite，零 CGO）建连，并静默 GORM 默认日志以防泄露业务数据。
	dsn := buildDSN(dbPath)
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("连接 SQLite 失败: %w", err)
	}

	sqlDB, err := gormDB.DB()
	if err != nil {
		return nil, fmt.Errorf("获取底层数据库连接失败: %w", err)
	}

	// SQLite 单进程写锁模型下固定连接池上限为 1，串行化写入以彻底避免并发竞争导致 SQLITE_BUSY。
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)

	// 4. 校验 WAL 模式生效后执行内嵌 SQL 迁移。
	if err := verifyJournalMode(sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}

	if err := runMigrations(sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}

	return &DB{
		gormDB: gormDB,
		sqlDB:  sqlDB,
	}, nil
}

// buildDSN 构造带连接级 PRAGMA 与 IMMEDIATE 事务锁的 SQLite URI，确保每次建连自动生效。
// `_txlock=immediate` 让写事务在 BEGIN 阶段即申请写锁，配合 busy_timeout 避免读升写死锁。
func buildDSN(dbPath string) string {
	u := url.URL{
		Scheme: "file",
		Path:   filepath.ToSlash(dbPath),
	}
	q := u.Query()
	for _, p := range sqlitePragmas {
		q.Add("_pragma", fmt.Sprintf("%s(%s)", p.name, p.value))
	}
	q.Set("_txlock", "immediate")
	u.RawQuery = q.Encode()
	return u.String()
}

// verifyJournalMode 确认连接可用且 WAL 日志模式已生效。
func verifyJournalMode(sqlDB *sql.DB) error {
	var mode string
	if err := sqlDB.QueryRow("PRAGMA journal_mode;").Scan(&mode); err != nil {
		return fmt.Errorf("检查 SQLite journal_mode 失败: %w", err)
	}
	if !strings.EqualFold(mode, "wal") {
		return fmt.Errorf("SQLite WAL 模式未生效，当前模式为 %q", mode)
	}
	return nil
}

// runMigrations 使用内嵌 SQL 文件自动升级数据库结构。
func runMigrations(sqlDB *sql.DB) error {
	provider, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, migrations.FS)
	if err != nil {
		return fmt.Errorf("初始化数据库迁移器失败: %w", err)
	}
	if _, err := provider.Up(context.Background()); err != nil {
		return fmt.Errorf("执行数据库迁移失败: %w", err)
	}
	return nil
}
