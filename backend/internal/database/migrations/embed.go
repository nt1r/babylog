// Package migrations 通过 embed.FS 内嵌所有 SQLite 数据库结构迁移脚本。
package migrations

import "embed"

// FS 内嵌所有 SQLite 数据库迁移脚本。
//
//go:embed *.sql
var FS embed.FS
