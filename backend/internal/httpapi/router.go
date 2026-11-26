// Package httpapi 装配 Gin HTTP 引擎、安全中间件、认证接口、管理员用户管理、多宝宝业务接口及静态前端托管。
package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/dashboard"
	"github.com/nt1r/babylog/backend/internal/export"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// Options 控制 HTTP 路由装配所需的依赖与运行参数。
type Options struct {
	Store           *auth.Store
	LoginGuard      *auth.LoginGuard
	CookieSecure    bool
	BabyStore       *baby.Store
	RecordStore     *records.Store
	DashboardSvc    *dashboard.Service
	ExportSvc       *export.Service
	VaccineStore    *vaccines.Store
	DistDir         string
	FallbackDistDir string
	Logger          *slog.Logger
}

// NewRouter 装配 Gin 引擎、安全中间件、认证、管理员用户管理、多宝宝档案、日常记录、首页看板、数据导出、疫苗管理与静态前端回退处理。
// 调用方应在进程启动入口（而非路由构造函数内）设置 gin.SetMode，避免全局状态并发竞争。
func NewRouter(opts Options) *gin.Engine {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}

	r := gin.New()
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	r.RemoveExtraSlash = false
	r.HandleMethodNotAllowed = true

	r.Use(recoveryMiddleware(logger))
	r.Use(requestLoggerMiddleware(logger))
	r.Use(apiSecurityMiddleware())

	loginGuard := opts.LoginGuard
	if loginGuard == nil {
		loginGuard = auth.NewLoginGuard()
	}
	authH := newAuthHandler(opts.Store, loginGuard, opts.CookieSecure, logger)
	staticH := newStaticHandler(opts.DistDir, opts.FallbackDistDir, logger)

	api := r.Group("/api")
	{
		// 公开认证接口：会话探测、登录与退出均不经过 requireAuthMiddleware。
		authGroup := api.Group("/auth")
		authGroup.GET("/session", authH.getSession)
		authGroup.POST("/login", authH.login)
		authGroup.POST("/logout", authH.logout)

		// 已认证路由组：允许处于强制改密态的用户完成自助改密。
		protected := api.Group("")
		protected.Use(requireAuthMiddleware(opts.Store, logger, opts.CookieSecure))
		{
			protected.POST("/auth/change-password", authH.changePassword)

			// 业务与管理路由组：统一要求已完成初始密码修改（must_change_password = false）。
			ready := protected.Group("")
			ready.Use(requirePasswordChangedMiddleware())
			{
				adminUsersH := newAdminUsersHandler(opts.Store, loginGuard, logger)
				adminGroup := ready.Group("/admin/users", requireAdminMiddleware())
				adminUsersH.registerRoutes(adminGroup)

				if opts.BabyStore != nil {
					babyH := newBabyHandler(opts.BabyStore, logger)
					ready.GET("/babies", babyH.listProfiles)
					ready.POST("/babies", babyH.createProfile)
					ready.PUT("/babies/:babyId", babyH.updateProfile)
					ready.DELETE("/babies/:babyId", babyH.deleteProfile)

					// 宝宝作用域业务路由组：统一按 (babyId, user.ID) 校验归属，未命中返回 404 防枚举。
					babyGroup := ready.Group("/babies/:babyId", requireBabyOwnershipMiddleware(opts.BabyStore, logger))
					{
						if opts.RecordStore != nil {
							recH := newRecordsHandler(opts.RecordStore, logger)
							recH.registerRoutes(babyGroup.Group("/records"))
						}

						if opts.DashboardSvc != nil {
							dashH := newDashboardHandler(opts.DashboardSvc, logger)
							dashGroup := babyGroup.Group("/dashboard")
							dashGroup.GET("/summary", dashH.getSummary)
							dashGroup.GET("/trends", dashH.getTrends)
						}

						if opts.ExportSvc != nil {
							expH := newExportHandler(opts.ExportSvc, logger)
							babyGroup.GET("/export/xlsx", expH.exportXLSX)
						}

						if opts.VaccineStore != nil {
							vacH := newVaccinesHandler(opts.VaccineStore, logger)
							vacGroup := babyGroup.Group("/vaccines")
							vacGroup.PUT("/default-clinic", babyH.updateDefaultClinic)
							vacH.registerRoutes(vacGroup)
						}
					}
				}
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
