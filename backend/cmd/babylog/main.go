// Package main 提供 BabyLog 的命令行入口，负责组装 HTTP 服务（serve）与管理员维护（admin）子命令。
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func newRootCommand() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:           "babylog",
		Short:         "BabyLog 后端服务与管理工具",
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	rootCmd.AddCommand(newServeCommand())
	rootCmd.AddCommand(newAdminCommand())

	return rootCmd
}

func main() {
	if err := newRootCommand().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
