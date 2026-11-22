// Package config 负责解析服务端与 CLI 运行所需的环境变量及工作目录路径。
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	// DefaultHost 为默认监听地址，仅绑定本机回环以降低暴露面。
	DefaultHost = "127.0.0.1"
	// DefaultPort 为默认 HTTP 监听端口，与前端 Vite 开发代理保持一致。
	DefaultPort = 21115
)

// Config 保存服务端运行所需的环境变量配置。
type Config struct {
	Host    string
	Port    int
	DataDir string
	DistDir string
	GinMode string
}

// Load 从环境变量加载运行配置并校验端口合法性。
func Load() (Config, error) {
	host := os.Getenv("HOST")
	if host == "" {
		host = DefaultHost
	}

	port := DefaultPort
	if rawPort, ok := os.LookupEnv("PORT"); ok {
		parsed, err := strconv.Atoi(strings.TrimSpace(rawPort))
		if err != nil || parsed < 0 || parsed > 65535 {
			return Config{}, fmt.Errorf("PORT 必须为 0 至 65535 之间的整数")
		}
		port = parsed
	}

	dataDir, err := ResolveDataDir()
	if err != nil {
		return Config{}, err
	}

	distDir := ""
	if rawDist := os.Getenv("BABYLOG_DIST_DIR"); rawDist != "" {
		absDist, absErr := filepath.Abs(ResolvePathFromWorkDir(rawDist))
		if absErr != nil {
			return Config{}, fmt.Errorf("解析 BABYLOG_DIST_DIR 失败: %w", absErr)
		}
		distDir = absDist
	}

	ginMode := os.Getenv("GIN_MODE")
	if ginMode == "" {
		ginMode = "release"
	}
	switch ginMode {
	case "debug", "release", "test":
	default:
		return Config{}, fmt.Errorf("GIN_MODE 必须为 debug、release 或 test")
	}

	return Config{
		Host:    host,
		Port:    port,
		DataDir: dataDir,
		DistDir: distDir,
		GinMode: ginMode,
	}, nil
}

// ResolvePathFromWorkDir 将相对路径基于调用方工作目录（BABYLOG_WORK_DIR）解析；
// 若已为绝对路径或未设置 BABYLOG_WORK_DIR，则原样返回。
func ResolvePathFromWorkDir(path string) string {
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	if workDir := os.Getenv("BABYLOG_WORK_DIR"); workDir != "" {
		return filepath.Join(workDir, path)
	}
	return path
}

// ResolveDataDir 解析 SQLite 数据目录，默认使用调用方工作目录下的 data/。
func ResolveDataDir() (string, error) {
	rawDir := os.Getenv("BABYLOG_DATA_DIR")
	if rawDir == "" {
		rawDir = "data"
	}
	absDir, err := filepath.Abs(ResolvePathFromWorkDir(rawDir))
	if err != nil {
		return "", fmt.Errorf("解析数据目录失败: %w", err)
	}
	return absDir, nil
}

// DefaultDistDir 返回未显式指定 BABYLOG_DIST_DIR 且未内嵌前端时的默认静态产物目录。
func DefaultDistDir() string {
	return ResolvePathFromWorkDir("dist")
}
