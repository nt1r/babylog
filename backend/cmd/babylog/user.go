package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/config"
	"github.com/nt1r/babylog/backend/internal/database"
)

const (
	userCreateUsage = "用法：babylog user create --username <用户名> --password-file <路径> [--force-change]"
	userListUsage   = "用法：babylog user list"
	userResetUsage  = "用法：babylog user reset-password --username <用户名> --password-file <路径> [--force-change]"
	userDisableUse  = "用法：babylog user disable --username <用户名>"
	userEnableUse   = "用法：babylog user enable --username <用户名>"
)

func newUserCommand() *cobra.Command {
	userCmd := &cobra.Command{
		Use:   "user",
		Short: "家庭用户账号维护命令",
	}
	userCmd.AddCommand(newUserCreateCommand())
	userCmd.AddCommand(newUserListCommand())
	userCmd.AddCommand(newUserResetPasswordCommand())
	userCmd.AddCommand(newUserSetDisabledCommand(true))
	userCmd.AddCommand(newUserSetDisabledCommand(false))
	return userCmd
}

func openCLIAuthStore() (*database.DB, *auth.Store, error) {
	dataDir, err := config.ResolveDataDir()
	if err != nil {
		return nil, nil, errors.New("无法打开数据库，请检查数据目录及权限")
	}
	db, err := database.Open(dataDir)
	if err != nil {
		return nil, nil, errors.New("无法打开数据库，请检查数据目录及权限")
	}
	return db, auth.NewStore(db.Gorm()), nil
}

func mapCLIAuthError(err error, fallback string) error {
	var valErr *auth.ValidationError
	switch {
	case errors.As(err, &valErr):
		return valErr
	case errors.Is(err, auth.ErrUsernameExists),
		errors.Is(err, auth.ErrUserNotFound),
		errors.Is(err, auth.ErrAdminProtected),
		errors.Is(err, auth.ErrAdminExists):
		return err
	default:
		return errors.New(fallback)
	}
}

func newUserCreateCommand() *cobra.Command {
	var username string
	var passwordFile string
	var forceChange bool

	cmd := &cobra.Command{
		Use:   "create",
		Short: "从本地密码文件创建普通家庭用户账号",
		Args: func(_ *cobra.Command, args []string) error {
			if len(args) != 0 {
				return errors.New(userCreateUsage)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			if username == "" || passwordFile == "" {
				return errors.New(userCreateUsage)
			}
			return runUserCreate(cmd.Context(), cmd.OutOrStdout(), username, passwordFile, forceChange)
		},
	}
	cmd.SetFlagErrorFunc(func(_ *cobra.Command, _ error) error {
		return errors.New(userCreateUsage)
	})
	cmd.Flags().StringVar(&username, "username", "", "用户登录名（1-128 字符）")
	cmd.Flags().StringVar(&passwordFile, "password-file", "", "包含初始密码的本地文件路径")
	cmd.Flags().BoolVar(&forceChange, "force-change", false, "是否强制用户首次登录后修改密码")
	return cmd
}

func runUserCreate(ctx context.Context, out io.Writer, username, passwordFile string, forceChange bool) error {
	if err := auth.ValidateUsername(username); err != nil {
		return err
	}
	password, err := readPasswordFile(config.ResolvePathFromWorkDir(passwordFile))
	if err != nil {
		return err
	}
	db, store, err := openCLIAuthStore()
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	created, err := store.CreateUser(ctx, username, password, forceChange)
	if err != nil {
		return mapCLIAuthError(err, "创建用户失败")
	}
	_, _ = fmt.Fprintf(out, "用户创建成功：%s (id=%d, role=%s)\n", created.Username, created.ID, created.Role)
	return nil
}

func newUserListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "列出全部用户的非敏感账号元数据",
		Args: func(_ *cobra.Command, args []string) error {
			if len(args) != 0 {
				return errors.New(userListUsage)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runUserList(cmd.Context(), cmd.OutOrStdout())
		},
	}
	cmd.SetFlagErrorFunc(func(_ *cobra.Command, _ error) error {
		return errors.New(userListUsage)
	})
	return cmd
}

func runUserList(ctx context.Context, out io.Writer) error {
	db, store, err := openCLIAuthStore()
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	users, err := store.ListUsers(ctx)
	if err != nil {
		return errors.New("查询用户列表失败")
	}

	w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ID\tUSERNAME\tROLE\tDISABLED\tCREATED_AT")
	for _, u := range users {
		_, _ = fmt.Fprintf(w, "%d\t%s\t%s\t%t\t%s\n", u.ID, u.Username, u.Role, u.Disabled, u.CreatedAt)
	}
	_ = w.Flush()
	return nil
}

func newUserResetPasswordCommand() *cobra.Command {
	var username string
	var passwordFile string
	var forceChange bool

	cmd := &cobra.Command{
		Use:   "reset-password",
		Short: "从本地密码文件重置指定用户（含唯一管理员）密码并吊销其全部会话",
		Args: func(_ *cobra.Command, args []string) error {
			if len(args) != 0 {
				return errors.New(userResetUsage)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			if username == "" || passwordFile == "" {
				return errors.New(userResetUsage)
			}
			return runUserResetPassword(cmd.Context(), cmd.OutOrStdout(), username, passwordFile, forceChange)
		},
	}
	cmd.SetFlagErrorFunc(func(_ *cobra.Command, _ error) error {
		return errors.New(userResetUsage)
	})
	cmd.Flags().StringVar(&username, "username", "", "目标用户名")
	cmd.Flags().StringVar(&passwordFile, "password-file", "", "包含新密码的本地文件路径")
	cmd.Flags().BoolVar(&forceChange, "force-change", false, "是否要求该用户下次登录后立即修改密码")
	return cmd
}

func runUserResetPassword(ctx context.Context, out io.Writer, username, passwordFile string, forceChange bool) error {
	if err := auth.ValidateUsername(username); err != nil {
		return err
	}
	password, err := readPasswordFile(config.ResolvePathFromWorkDir(passwordFile))
	if err != nil {
		return err
	}
	db, store, err := openCLIAuthStore()
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	updated, err := store.ResetUserPasswordByUsername(ctx, username, password, forceChange)
	if err != nil {
		return mapCLIAuthError(err, "重置密码失败")
	}
	_, _ = fmt.Fprintf(out, "密码已重置并吊销全部会话：%s\n", updated.Username)
	return nil
}

func newUserSetDisabledCommand(disable bool) *cobra.Command {
	var username string
	use := "enable"
	short := "启用已停用的普通用户账号"
	usage := userEnableUse
	if disable {
		use = "disable"
		short = "停用普通用户账号并立即吊销其全部会话"
		usage = userDisableUse
	}

	cmd := &cobra.Command{
		Use:   use,
		Short: short,
		Args: func(_ *cobra.Command, args []string) error {
			if len(args) != 0 {
				return errors.New(usage)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			if username == "" {
				return errors.New(usage)
			}
			return runUserSetDisabled(cmd.Context(), cmd.OutOrStdout(), username, disable)
		},
	}
	cmd.SetFlagErrorFunc(func(_ *cobra.Command, _ error) error {
		return errors.New(usage)
	})
	cmd.Flags().StringVar(&username, "username", "", "目标用户名")
	return cmd
}

func runUserSetDisabled(ctx context.Context, out io.Writer, username string, disable bool) error {
	if err := auth.ValidateUsername(username); err != nil {
		return err
	}
	db, store, err := openCLIAuthStore()
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	updated, err := store.SetUserDisabledByUsername(ctx, username, disable)
	if err != nil {
		if disable {
			return mapCLIAuthError(err, "停用用户失败")
		}
		return mapCLIAuthError(err, "启用用户失败")
	}
	if disable {
		_, _ = fmt.Fprintf(out, "用户已停用并吊销全部会话：%s\n", updated.Username)
	} else {
		_, _ = fmt.Fprintf(out, "用户已重新启用：%s\n", updated.Username)
	}
	return nil
}
