//go:build embedwebui

// Package webui 负责在单二进制发布构建（`go build -tags embedwebui`）时内嵌前端静态产物。
// 本文件与 stub.go 通过互斥的 `//go:build` 条件编译标签二选一参与编译，确保开发与发布态互不污染。
package webui

import (
	"embed"
	"io/fs"
)

// embeddedDist 在编译期将 dist/ 目录内全部文件（含以 . 或 _ 开头的文件与目录）打包进只读内存文件系统。
//
//go:embed all:dist
var embeddedDist embed.FS

// DistFS 返回去掉 dist/ 目录前缀的内嵌前端静态文件系统，供 HTTP 静态处理器直接按根路径读取。
func DistFS() (fs.FS, error) {
	return fs.Sub(embeddedDist, "dist")
}
