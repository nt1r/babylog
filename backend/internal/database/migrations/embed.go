// Package migrations 通过 embed.FS 内嵌所有 SQLite 数据库结构迁移脚本。
package migrations

import "embed"

// FS 通过 Go 编译器指令 `//go:embed` 在编译期将同目录所有 SQL 迁移脚本打入二进制，
// 使发布后的单二进制无需依赖外部迁移文件即可自动建表升级。
//
//go:embed *.sql
var FS embed.FS
