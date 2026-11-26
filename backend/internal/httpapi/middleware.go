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

const (
	ctxAuthUserKey    = "authUser"
	ctxBabyProfileKey = "babyProfile"
	errCodePwdChange  = "PASSWORD_CHANGE_REQUIRED"
)

// requireAuthMiddleware 校验有效且未停用的用户会话，并将 [*auth.AuthUser] 注入请求上下文。
func requireAuthMiddleware(store *auth.Store, logger *slog.Logger, cookieSecure bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, hasCookie := readSessionCookie(c.Request)
		user, err := store.GetSession(c.Request.Context(), token)
		if err != nil {
			logger.Error("requireAuth getSession failed", "error", err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
			return
		}
		if user == nil {
			if hasCookie {
				clearSessionCookie(c, cookieSecure)
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
			return
		}
		c.Set(ctxAuthUserKey, user)
		c.Next()
	}
}

// mustAuthUser 从 Gin 上下文提取已认证的 [*auth.AuthUser]。
func mustAuthUser(c *gin.Context) (*auth.AuthUser, bool) {
	raw, ok := c.Get(ctxAuthUserKey)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return nil, false
	}
	user, ok := raw.(*auth.AuthUser)
	if !ok || user == nil || user.ID <= 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return nil, false
	}
	return user, true
}

// requirePasswordChangedMiddleware 拦截仍处于强制改密态（must_change_password = true）的用户，
// 防止绕过前端直接调用宝宝、记录或管理接口。
func requirePasswordChangedMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := mustAuthUser(c)
		if !ok {
			c.Abort()
			return
		}
		if user.MustChangePassword {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "请先修改初始密码",
				"code":  errCodePwdChange,
			})
			return
		}
		c.Next()
	}
}

// requireAdminMiddleware 仅放行角色为 admin 的唯一系统管理员，普通用户统一返回 403。
func requireAdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := mustAuthUser(c)
		if !ok {
			c.Abort()
			return
		}
		if user.Role != auth.RoleAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "仅管理员可执行此操作"})
			return
		}
		c.Next()
	}
}

// requireBabyOwnershipMiddleware 解析路径参数 :babyId 并按 (babyId, user.ID) 校验归属，
// 目标不存在或属于其他用户时统一返回 HTTP 404 防 ID 枚举；校验通过后注入 [*baby.Profile]。
func requireBabyOwnershipMiddleware(babyStore *baby.Store, logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := mustAuthUser(c)
		if !ok {
			c.Abort()
			return
		}
		babyID, ok := parsePositiveIntParam(c, "babyId", "无效的宝宝编号")
		if !ok {
			c.Abort()
			return
		}
		profile, err := babyStore.GetByIDForUser(c.Request.Context(), user.ID, babyID)
		if err != nil {
			logger.Error("requireBabyOwnership failed", "error", err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
			return
		}
		if profile == nil {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": baby.ErrNotFound.Error()})
			return
		}
		c.Set(ctxBabyProfileKey, profile)
		c.Next()
	}
}

// mustBabyProfile 从 Gin 上下文读取已通过 requireBabyOwnershipMiddleware 校验的完整宝宝档案指针。
func mustBabyProfile(c *gin.Context) (*baby.Profile, bool) {
	raw, ok := c.Get(ctxBabyProfileKey)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return nil, false
	}
	profile, ok := raw.(*baby.Profile)
	if !ok || profile == nil || profile.ID <= 0 || profile.BirthDate == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return nil, false
	}
	return profile, true
}

// mustBabyID 从已校验的宝宝档案上下文提取宝宝 ID。
func mustBabyID(c *gin.Context) (int64, bool) {
	profile, ok := mustBabyProfile(c)
	if !ok {
		return 0, false
	}
	return profile.ID, true
}

// apiSecurityMiddleware 为所有 /api/* 响应强制禁用缓存，并对写操作执行 Same-Origin 防护。
func apiSecurityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.Next()
			return
		}

		c.Header("Cache-Control", "no-store")
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

// Error 实现内置 error 接口，返回静态中文错误信息。
func (e messageError) Error() string { return string(e) }

const errCrossOrigin = messageError("不允许跨来源操作")

// requestLoggerMiddleware 使用 slog 记录结构化 HTTP 访问日志，不输出查询参数、请求体或凭据。
func requestLoggerMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Info("http request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
		)
	}
}

// recoveryMiddleware 捕获处理链路中的未预期 panic，禁用 Gin 原始请求头输出并通过 slog 记录脱敏信息。
func recoveryMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) {
		logger.Error("http panic recovered",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"panic", recovered,
		)
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
	})
}
