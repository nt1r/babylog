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
)

func newServeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "启动 BabyLog HTTP 服务",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServe(cmd.Context())
		},
	}
}

func runServe(parentCtx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	gin.SetMode(cfg.GinMode)

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	db, err := database.Open(cfg.DataDir)
	if err != nil {
		logger.Error("database open failed", "error", err)
		return errors.New("无法打开数据库，请检查数据目录及权限")
	}
	defer func() { _ = db.Close() }()

	store := auth.NewStore(db.Gorm())
	babyStore := baby.NewStore(db.Gorm())
	recordStore := records.NewStore(db.Gorm())
	dashboardSvc := dashboard.NewService(recordStore)
	router := httpapi.NewRouter(httpapi.Options{
		Store:           store,
		BabyStore:       babyStore,
		RecordStore:     recordStore,
		DashboardSvc:    dashboardSvc,
		DistDir:         cfg.DistDir,
		FallbackDistDir: config.DefaultDistDir(),
		Logger:          logger,
	})

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Error("listen failed", "addr", addr, "error", err)
		return errors.New("服务启动失败，请检查监听地址和端口")
	}

	srv := &http.Server{
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 * 1024,
	}

	listeningPort := cfg.Port
	if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok {
		listeningPort = tcpAddr.Port
	}
	displayHost := cfg.Host
	if strings.Contains(displayHost, ":") {
		displayHost = "[" + displayHost + "]"
	}
	fmt.Fprintf(os.Stdout, "BabyLog 服务已启动：http://%s:%d\n", displayHost, listeningPort)

	ctx, stop := signal.NotifyContext(parentCtx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		if serveErr := srv.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			errCh <- serveErr
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
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
