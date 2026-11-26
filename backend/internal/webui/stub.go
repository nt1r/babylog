//go:build !embedwebui

// Package webui 在未启用 embedwebui 构建标签（如开发期 air 热重载或常规测试）时提供空实现，
// 与 embed.go 通过互斥的 `//go:build` 条件编译标签切换，避免开发二进制内嵌过期前端产物并加快重编译速度。
package webui

import "io/fs"

// DistFS 在开发构建中直接返回 [fs.ErrNotExist]，由静态处理器回退到本地目录或 Vite 开发服务。
func DistFS() (fs.FS, error) {
	return nil, fs.ErrNotExist
}
