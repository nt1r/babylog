// Package httpapi 装配 Gin HTTP 引擎、安全中间件、认证接口、核心业务接口及静态前端托管。
package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// Options 控制 HTTP 路由装配所需的依赖与运行参数。
type Options struct {
	Store           *auth.Store
	BabyStore       *baby.Store
	RecordStore     *records.Store
	DashboardSvc    *dashboard.Service
	VaccineStore    *vaccines.Store
	DistDir         string
	FallbackDistDir string
	Logger          *slog.Logger
}

// NewRouter 装配 Gin 引擎、安全中间件、认证接口与静态前端回退处理。
// 调用方应在进程启动入口（而非路由构造函数内）设置 gin.SetMode，避免全局状态并发竞争。
func NewRouter(opts Options) *gin.Engine {
	// 未传入 Logger 时回退到 slog.DiscardHandler（静默丢弃日志），便于测试环境复用而无需到处判空。
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}

	r := gin.New()
	// 关闭自动重定向与路径改写，确保路径穿越拦截与 REST 状态码语义精确可控。
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	r.RemoveExtraSlash = false
	r.HandleMethodNotAllowed = true

	// 全局中间件按洋葱模型依次包裹：最外层捕获 panic → 统计全链路访问日志与耗时 → 校验 API 缓存与同源安全。
	r.Use(recoveryMiddleware(logger))
	r.Use(requestLoggerMiddleware(logger))
	r.Use(apiSecurityMiddleware())

	authH := newAuthHandler(opts.Store, logger)
	staticH := newStaticHandler(opts.DistDir, opts.FallbackDistDir, logger)

	api := r.Group("/api")
	{
		// 公开认证接口：会话探测、登录与退出均不经过 requireAuthMiddleware。
		authGroup := api.Group("/auth")
		authGroup.GET("/session", authH.getSession)
		authGroup.POST("/login", authH.login)
		authGroup.POST("/logout", authH.logout)

		// 受保护路由组：统一要求管理员已登录；业务子模块按依赖是否注入条件挂载，便于单元测试局部装配。
		protected := api.Group("")
		protected.Use(requireAuthMiddleware(opts.Store, logger))
		{
			if opts.BabyStore != nil {
				babyH := newBabyHandler(opts.BabyStore, logger)
				protected.GET("/baby", babyH.getProfile)
				protected.POST("/baby", babyH.createProfile)
				protected.PUT("/baby", babyH.updateProfile)
			}

			// 日常记录与首页看板额外挂载 requireBabyProfileMiddleware，未建档时统一前置返回 409。
			if opts.BabyStore != nil && opts.RecordStore != nil {
				recH := newRecordsHandler(opts.RecordStore, logger)
				recGroup := protected.Group("/records", requireBabyProfileMiddleware(opts.BabyStore, logger))
				recH.registerRoutes(recGroup)
			}

			if opts.BabyStore != nil && opts.DashboardSvc != nil {
				dashH := newDashboardHandler(opts.DashboardSvc, logger)
				dashGroup := protected.Group("/dashboard", requireBabyProfileMiddleware(opts.BabyStore, logger))
				dashGroup.GET("/summary", dashH.getSummary)
				dashGroup.GET("/trends", dashH.getTrends)
			}

			if opts.BabyStore != nil && opts.VaccineStore != nil {
				vacH := newVaccinesHandler(opts.VaccineStore, logger)
				vacGroup := protected.Group("/vaccines", requireBabyProfileMiddleware(opts.BabyStore, logger))
				vacH.registerRoutes(vacGroup)
			}
		}
	}

	r.NoMethod(func(c *gin.Context) {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "不支持此请求方法"})
	})

	// 未命中已注册路由时：/api/* 一律返回 404 JSON，避免错路由误回退到前端 index.html；其余路径交给静态托管与 SPA 回退。
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "接口不存在"})
			return
		}
		staticH.serve(c)
	})

	return r
}
