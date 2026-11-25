package config_test

import (
	"path/filepath"
	"testing"

	"github.com/nt1r/babylog/backend/internal/config"
)

func TestLoadDefaultsAndValidation(t *testing.T) {
	t.Run("未设置环境变量时采用默认配置", func(t *testing.T) {
		workDir := t.TempDir()
		t.Setenv("HOST", "")
		t.Setenv("BABYLOG_DATA_DIR", "")
		t.Setenv("BABYLOG_DIST_DIR", "")
		t.Setenv("GIN_MODE", "")
		t.Setenv("BABYLOG_WORK_DIR", workDir)

		cfg, err := config.Load()
		if err != nil {
			t.Fatalf("Load() unexpected error: %v", err)
		}
		if cfg.Host != config.DefaultHost {
			t.Errorf("expected default host %q, got %q", config.DefaultHost, cfg.Host)
		}
		if cfg.Port != config.DefaultPort {
			t.Errorf("expected default port %d, got %d", config.DefaultPort, cfg.Port)
		}
		if cfg.GinMode != "release" {
			t.Errorf("expected default gin mode release, got %q", cfg.GinMode)
		}
		wantDataDir := filepath.Join(workDir, "data")
		if cfg.DataDir != wantDataDir {
			t.Errorf("expected data dir %q, got %q", wantDataDir, cfg.DataDir)
		}
	})

	// PORT=0 放行用于进程测试分配临时端口；显式传入空串 PORT="" 与未设置不同，会被显式拒绝。
	t.Run("校验PORT范围并允许临时端口0", func(t *testing.T) {
		t.Setenv("PORT", "0")
		cfg, err := config.Load()
		if err != nil || cfg.Port != 0 {
			t.Fatalf("expected PORT=0 valid, got (%d, %v)", cfg.Port, err)
		}

		for _, invalid := range []string{"-1", "65536", "abc", ""} {
			t.Setenv("PORT", invalid)
			if _, err := config.Load(); err == nil {
				t.Errorf("expected PORT=%q rejected", invalid)
			}
		}
	})

	// 跨目录脚本通过 BABYLOG_WORK_DIR 透传调用方目录作为相对路径基准。
	t.Run("相对路径按BABYLOG_WORK_DIR解析", func(t *testing.T) {
		workDir := t.TempDir()
		t.Setenv("BABYLOG_WORK_DIR", workDir)
		t.Setenv("BABYLOG_DATA_DIR", "./custom-data")
		t.Setenv("BABYLOG_DIST_DIR", "./custom-dist")

		cfg, err := config.Load()
		if err != nil {
			t.Fatalf("Load() unexpected error: %v", err)
		}
		if want := filepath.Join(workDir, "custom-data"); cfg.DataDir != want {
			t.Errorf("expected DataDir %q, got %q", want, cfg.DataDir)
		}
		if want := filepath.Join(workDir, "custom-dist"); cfg.DistDir != want {
			t.Errorf("expected DistDir %q, got %q", want, cfg.DistDir)
		}
		if want := filepath.Join(workDir, "dist"); config.DefaultDistDir() != want {
			t.Errorf("expected DefaultDistDir %q, got %q", want, config.DefaultDistDir())
		}
	})

	t.Run("校验GIN_MODE白名单", func(t *testing.T) {
		for _, mode := range []string{"debug", "release", "test"} {
			t.Setenv("GIN_MODE", mode)
			cfg, err := config.Load()
			if err != nil || cfg.GinMode != mode {
				t.Errorf("expected GIN_MODE=%q valid, got (%q, %v)", mode, cfg.GinMode, err)
			}
		}

		t.Setenv("GIN_MODE", "prod")
		if _, err := config.Load(); err == nil {
			t.Error("expected invalid GIN_MODE rejected")
		}
	})
}
