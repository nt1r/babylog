//go:build embedwebui

// Package webui 负责在单二进制构建（-tags embedwebui）时内嵌前端静态产物。
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embeddedDist embed.FS

// DistFS 返回去掉 dist/ 前缀的内嵌前端静态文件系统。
func DistFS() (fs.FS, error) {
	return fs.Sub(embeddedDist, "dist")
}
