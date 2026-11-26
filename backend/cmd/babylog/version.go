package main

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

const versionUsage = "用法：babylog version"

// 构建元信息通过 Go 链接器参数 `-ldflags "-X main.version=..."` 在发布构建时覆盖写入；
// 本地开发直接 `go run` 时保持默认占位值。
var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "unknown"
)

func formatVersionString() string {
	return fmt.Sprintf("babylog %s (commit: %s, built: %s)", version, commit, buildDate)
}

func newVersionCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "version",
		Short: "显示 BabyLog 版本与构建信息",
		Args: func(_ *cobra.Command, args []string) error {
			if len(args) != 0 {
				return errors.New(versionUsage)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), formatVersionString())
			return nil
		},
	}

	cmd.SetFlagErrorFunc(func(_ *cobra.Command, _ error) error {
		return errors.New(versionUsage)
	})

	return cmd
}
