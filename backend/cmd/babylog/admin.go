package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/config"
)

const initAdminUsage = "用法：babylog admin init --password-file <路径> [--username <用户名>]"

func newAdminCommand() *cobra.Command {
	adminCmd := &cobra.Command{
		Use:   "admin",
		Short: "管理员账户维护命令",
	}
	adminCmd.AddCommand(newAdminInitCommand())
	return adminCmd
}

// newAdminInitCommand 构建 `babylog admin init` 子命令。
// 通过本地密码文件（而非命令行参数）传入密码，避免密码暴露在进程列表或 shell 历史中。
func newAdminInitCommand() *cobra.Command {
	var passwordFile string
	var username string

	cmd := &cobra.Command{
		Use:   "init",
		Short: "从本地密码文件初始化唯一管理员账户",
		// 自定义位置参数校验，保证错误输出统一为中文用法提示而非 Cobra 默认英文文本。
		Args: func(_ *cobra.Command, args []string) error {
			if len(args) != 0 {
				return errors.New(initAdminUsage)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			if passwordFile == "" {
				return errors.New(initAdminUsage)
			}
			return runAdminInit(cmd.Context(), cmd.OutOrStdout(), passwordFile, username)
		},
	}

	// 覆写非法 Flag 的报错文本，保持全命令中文提示风格一致。
	cmd.SetFlagErrorFunc(func(_ *cobra.Command, _ error) error {
		return errors.New(initAdminUsage)
	})
	// StringVar 将命令行参数绑定到局部变量的内存地址（&passwordFile / &username）。
	cmd.Flags().StringVar(&passwordFile, "password-file", "", "包含管理员密码的本地文件路径")
	cmd.Flags().StringVar(&username, "username", "admin", "管理员用户名（默认 admin）")

	return cmd
}

// runAdminInit 校验用户名与本地密码文件，打开 SQLite 并创建唯一管理员账户。
// 接收 io.Writer 而非直接写 os.Stdout，便于 CLI 单元测试直接捕获并断言输出内容。
func runAdminInit(ctx context.Context, out io.Writer, passwordFile, username string) error {
	if err := auth.ValidateUsername(username); err != nil {
		return err
	}

	resolvedFile := config.ResolvePathFromWorkDir(passwordFile)
	password, err := readPasswordFile(resolvedFile)
	if err != nil {
		return err
	}

	db, store, err := openCLIAuthStore()
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	if err := store.InitializeAdministrator(ctx, username, password); err != nil {
		return mapCLIAuthError(err, "管理员初始化失败")
	}

	_, _ = fmt.Fprintln(out, "管理员初始化成功")
	return nil
}

// readPasswordFile 读取本地密码文件并校验文件类型、字节上限与密码长度。
// 字节上限按 UTF-8 单字符最多 4 字节加上可选的单个尾部 CRLF（+2）计算，防止大文件读入内存。
func readPasswordFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("无法读取密码文件，请检查路径及权限")
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		return "", errors.New("无法读取密码文件，请检查路径及权限")
	}
	// 仅允许普通文件，拒绝目录、命名管道（FIFO）或设备文件以防阻塞。
	if !info.Mode().IsRegular() {
		return "", errors.New("密码文件必须为普通文件")
	}

	const maxBytes = int64(auth.MaxPasswordLength*4 + 2)
	if info.Size() > maxBytes {
		return "", errors.New("密码文件过大，密码最多为 1024 个字符")
	}

	// 除 Stat 预检外再套一层 LimitReader(maxBytes+1)：防止文件在 Stat 与 Read 之间被并发追加变大，
	// 最多多读 1 字节即可准确判断是否超限，同时避免一次性将超大内容读入内存。
	contents, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return "", errors.New("无法读取密码文件，请检查路径及权限")
	}
	if int64(len(contents)) > maxBytes {
		return "", errors.New("密码文件过大，密码最多为 1024 个字符")
	}

	password := stripSingleTrailingNewline(string(contents))
	if err := auth.ValidatePassword(password); err != nil {
		return "", err
	}
	return password, nil
}

// stripSingleTrailingNewline 仅剥离文件末尾至多一个 LF 或 CRLF，其余前后空白与换行原样保留。
func stripSingleTrailingNewline(s string) string {
	if strings.HasSuffix(s, "\r\n") {
		return s[:len(s)-2]
	}
	if strings.HasSuffix(s, "\n") {
		return s[:len(s)-1]
	}
	return s
}
