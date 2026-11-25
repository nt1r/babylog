package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/spf13/cobra"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/config"
	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/httpapi"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// newServeCommand 构建 `babylog serve` 子命令，用于启动内置 HTTP 服务。
func newServeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "启动 BabyLog HTTP 服务",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServe(cmd.Context())
		},
	}
}

// runServe 串联配置加载、数据库与依赖装配、TCP 监听及基于系统信号的优雅停机主流程。
func runServe(parentCtx context.Context) error {
	// 1. 加载并校验运行配置；Gin 模式必须在创建路由前于进程入口统一设置，避免全局状态并发竞争。
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	gin.SetMode(cfg.GinMode)

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// 2. 打开 SQLite 数据库并注册延迟关闭：
	// Go 的 defer 会在当前函数返回前按后进先出（LIFO）顺序执行，用于确保资源释放；
	// `_ = db.Close()` 表示显式忽略关闭返回值（进程即将退出）。
	db, err := database.Open(cfg.DataDir)
	if err != nil {
		logger.Error("database open failed", "error", err)
		return errors.New("无法打开数据库，请检查数据目录及权限")
	}
	defer func() { _ = db.Close() }()

	// 3. 显式注入认证、宝宝档案、日常记录、首页看板、疫苗存储与静态资源配置，组装 HTTP 路由。
	store := auth.NewStore(db.Gorm())
	babyStore := baby.NewStore(db.Gorm())
	recordStore := records.NewStore(db.Gorm())
	dashboardSvc := dashboard.NewService(recordStore)
	vaccineStore := vaccines.NewStore(db.Gorm())
	router := httpapi.NewRouter(httpapi.Options{
		Store:           store,
		BabyStore:       babyStore,
		RecordStore:     recordStore,
		DashboardSvc:    dashboardSvc,
		VaccineStore:    vaccineStore,
		DistDir:         cfg.DistDir,
		FallbackDistDir: config.DefaultDistDir(),
		Logger:          logger,
	})

	// 4. 先绑定监听套接字再交给 http.Server，便于提前暴露端口占用错误并支持 PORT=0 随机分配端口。
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Error("listen failed", "addr", addr, "error", err)
		return errors.New("服务启动失败，请检查监听地址和端口")
	}

	// 显式配置超时与请求头字节上限，防止慢速连接（Slowloris）或超大请求头耗尽资源。
	srv := &http.Server{
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 * 1024,
	}

	// 通过 Go 类型断言 `.(*net.TCPAddr)` 读取内核实际分配的端口（当 PORT=0 时与 cfg.Port 不同）。
	listeningPort := cfg.Port
	if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok {
		listeningPort = tcpAddr.Port
	}
	displayHost := cfg.Host
	if strings.Contains(displayHost, ":") {
		// IPv6 地址在 URL 中须用方括号包裹，例如 http://[::1]:21115。
		displayHost = "[" + displayHost + "]"
	}
	fmt.Fprintf(os.Stdout, "BabyLog 服务已启动：http://%s:%d\n", displayHost, listeningPort)

	// 5. 监听 SIGINT（Ctrl+C）与 SIGTERM（容器/系统停止信号）：
	// 收到信号后 ctx.Done() 通道关闭，触发下方优雅停机；defer stop() 在退出时注销信号监听。
	ctx, stop := signal.NotifyContext(parentCtx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// 在后台协程（goroutine）中运行 HTTP 服务，避免阻塞主协程监听退出信号；
	// 使用容量为 1 的缓冲通道（chan）传递退出结果，确保即便主协程先走停机分支，后台发送也不会永久阻塞泄漏。
	errCh := make(chan error, 1)
	go func() {
		// http.ErrServerClosed 是主动调用 srv.Shutdown 后的正常返回，不视为故障。
		if serveErr := srv.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			errCh <- serveErr
			return
		}
		errCh <- nil
	}()

	// select 同时等待「系统停机信号」与「HTTP 服务异常退出」，哪个通道先就绪就进入对应分支。
	select {
	case <-ctx.Done():
		// 给予在途请求最多 10 秒完成响应，再强制关闭连接，并等待 Serve 协程彻底退出。
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if shutdownErr := srv.Shutdown(shutdownCtx); shutdownErr != nil {
			logger.Error("graceful shutdown failed", "error", shutdownErr)
		}
		return <-errCh
	case serveErr := <-errCh:
		if serveErr != nil {
			logger.Error("http server error", "error", serveErr)
			return errors.New("服务启动失败，请检查监听地址和端口")
		}
		return nil
	}
}
