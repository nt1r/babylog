package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
	"github.com/nt1r/babylog/backend/internal/baby"
)

const ctxBabyIDKey = "babyID"

// requireAuthMiddleware 校验有效管理员会话，未认证或会话已过期时统一返回 401 中文 JSON。
func requireAuthMiddleware(store *auth.Store, logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, hasCookie := readSessionCookie(c.Request)
		user, err := store.GetSession(c.Request.Context(), token)
		if err != nil {
			if logger != nil {
				logger.Error("requireAuth getSession failed", "error", err)
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
			return
		}
		if user == nil {
			if hasCookie {
				clearSessionCookie(c)
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
			return
		}
		c.Set("adminUser", user)
		c.Next()
	}
}

// requireBabyProfileMiddleware 校验单宝宝档案已完成建档，并将 babyID 注入请求上下文。
// 对依赖宝宝档案的记录与看板接口而言，未建档属于前置状态冲突，因此统一返回 409 Conflict。
func requireBabyProfileMiddleware(babyStore *baby.Store, logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		profile, err := babyStore.GetFirst(c.Request.Context())
		if err != nil {
			if logger != nil {
				logger.Error("requireBabyProfile failed", "error", err)
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
			return
		}
		if profile == nil {
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"error": baby.ErrNotFound.Error()})
			return
		}
		c.Set(ctxBabyIDKey, profile.ID)
		c.Next()
	}
}

// mustBabyID 从 Gin 上下文读取已通过 requireBabyProfileMiddleware 校验的宝宝 ID。
func mustBabyID(c *gin.Context) (int64, bool) {
	id, ok := c.Get(ctxBabyIDKey)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return 0, false
	}
	babyID, ok := id.(int64)
	if !ok || babyID <= 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return 0, false
	}
	return babyID, true
}

// apiSecurityMiddleware 为所有 /api/* 响应强制禁用缓存，并对写操作执行 Same-Origin 防护。
func apiSecurityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.Next()
			return
		}

		c.Header("Cache-Control", "no-store")
		// GET/HEAD 为只读请求；其余变更状态的方法均须满足同源校验，防止跨站 CSRF。
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			if err := enforceSameOrigin(c.Request); err != nil {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
		}

		c.Next()
	}
}

// enforceSameOrigin 校验请求的 Origin Host 与 Host 请求头是否一致。
// 若未携带 Origin（例如同源直接请求或非浏览器客户端调用）则放行，由 SameSite=Strict Cookie 兜底。
func enforceSameOrigin(r *http.Request) error {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return nil
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return errCrossOrigin
	}
	if !strings.EqualFold(parsed.Host, r.Host) {
		return errCrossOrigin
	}
	return nil
}

type messageError string

func (e messageError) Error() string { return string(e) }

const errCrossOrigin = messageError("不允许跨来源操作")

// requestLoggerMiddleware 使用 slog 记录结构化 HTTP 访问日志，不输出查询参数、请求体或凭据。
func requestLoggerMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if logger == nil {
			return
		}
		logger.Info("http request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
		)
	}
}

// recoveryMiddleware 捕获处理链路中的未预期 panic，禁用 Gin 默认含原始请求头的 stderr 输出，
// 改为统一通过 slog 记录脱敏信息并返回中文 JSON 500 响应。
func recoveryMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) {
		if logger != nil {
			logger.Error("http panic recovered",
				"method", c.Request.Method,
				"path", c.Request.URL.Path,
				"panic", recovered,
			)
		}
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
	})
}
