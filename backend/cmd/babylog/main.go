// Package main 提供 BabyLog 的命令行入口，负责组装 HTTP 服务（serve）、管理员维护（admin）、用户维护（user）与版本查询（version）子命令。
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// newRootCommand 构建顶层 Cobra 根命令并挂载所有子命令。
// 关闭 Cobra 默认的英文错误打印与用法刷屏（SilenceUsage / SilenceErrors），
// 改为由 main 统一向 stderr 输出子命令返回的中文错误。
func newRootCommand() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:           "babylog",
		Short:         "BabyLog 后端服务与管理工具",
		Version:       formatVersionString(),
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	rootCmd.SetVersionTemplate("{{.Version}}\n")

	rootCmd.AddCommand(newServeCommand())
	rootCmd.AddCommand(newAdminCommand())
	rootCmd.AddCommand(newUserCommand())
	rootCmd.AddCommand(newVersionCommand())

	return rootCmd
}

func main() {
	if err := newRootCommand().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
