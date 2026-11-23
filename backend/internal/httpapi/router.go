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
)

// Options 控制 HTTP 路由装配所需的依赖与运行参数。
type Options struct {
	Store        *auth.Store
	BabyStore    *baby.Store
	RecordStore  *records.Store
	DashboardSvc *dashboard.Service
	DistDir      string
	Logger       *slog.Logger
}

// NewRouter 装配 Gin 引擎、安全中间件、认证接口与静态前端回退处理。
// 调用方应在进程启动入口（而非路由构造函数内）设置 gin.SetMode，避免全局状态并发竞争。
func NewRouter(opts Options) *gin.Engine {
	r := gin.New()
	// 关闭自动重定向与路径改写，确保路径穿越拦截与 REST 状态码语义精确可控。
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	r.RemoveExtraSlash = false
	r.HandleMethodNotAllowed = true

	r.Use(recoveryMiddleware(opts.Logger))
	r.Use(requestLoggerMiddleware(opts.Logger))
	r.Use(apiSecurityMiddleware())

	authH := newAuthHandler(opts.Store, opts.Logger)
	staticH := newStaticHandler(opts.DistDir, opts.Logger)

	api := r.Group("/api")
	{
		authGroup := api.Group("/auth")
		authGroup.GET("/session", authH.getSession)
		authGroup.POST("/login", authH.login)
		authGroup.POST("/logout", authH.logout)

		protected := api.Group("")
		protected.Use(requireAuthMiddleware(opts.Store, opts.Logger))
		{
			if opts.BabyStore != nil {
				babyH := newBabyHandler(opts.BabyStore, opts.Logger)
				protected.GET("/baby", babyH.getProfile)
				protected.POST("/baby", babyH.createProfile)
				protected.PUT("/baby", babyH.updateProfile)
			}

			if opts.BabyStore != nil && opts.RecordStore != nil {
				recH := newRecordsHandler(opts.RecordStore, opts.Logger)
				recGroup := protected.Group("/records", requireBabyProfileMiddleware(opts.BabyStore, opts.Logger))
				recGroup.GET("/defaults", recH.getDefaults)

				recGroup.GET("/feeding", recH.listFeeding)
				recGroup.POST("/feeding", recH.createFeeding)
				recGroup.PUT("/feeding/:id", recH.updateFeeding)
				recGroup.DELETE("/feeding/:id", recH.deleteFeeding)

				recGroup.GET("/sleep", recH.listSleep)
				recGroup.POST("/sleep", recH.createSleep)
				recGroup.PUT("/sleep/:id", recH.updateSleep)
				recGroup.DELETE("/sleep/:id", recH.deleteSleep)

				recGroup.GET("/care", recH.listCare)
				recGroup.POST("/care", recH.createCare)
				recGroup.PUT("/care/:id", recH.updateCare)
				recGroup.DELETE("/care/:id", recH.deleteCare)

				recGroup.GET("/health", recH.listHealth)
				recGroup.POST("/health", recH.createHealth)
				recGroup.PUT("/health/:id", recH.updateHealth)
				recGroup.DELETE("/health/:id", recH.deleteHealth)
			}

			if opts.BabyStore != nil && opts.DashboardSvc != nil {
				dashH := newDashboardHandler(opts.DashboardSvc, opts.Logger)
				dashGroup := protected.Group("/dashboard", requireBabyProfileMiddleware(opts.BabyStore, opts.Logger))
				dashGroup.GET("/summary", dashH.getSummary)
				dashGroup.GET("/trends", dashH.getTrends)
			}
		}
	}

	r.NoMethod(func(c *gin.Context) {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "不支持此请求方法"})
	})

	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "接口不存在"})
			return
		}
		staticH.serve(c)
	})

	return r
}
