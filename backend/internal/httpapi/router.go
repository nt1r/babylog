// Package httpapi 装配 Gin HTTP 引擎、安全中间件、认证接口及静态前端托管。
package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
)

// Options 控制 HTTP 路由装配所需的依赖与运行参数。
type Options struct {
	Store   *auth.Store
	DistDir string
	Logger  *slog.Logger
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
