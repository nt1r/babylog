package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
)

// maxAuthBodyBytes 限制认证与账号凭据请求体最大为 16 KiB，防止恶意超大载荷消耗内存。
const maxAuthBodyBytes = 16 * 1024

type authHandler struct {
	store        *auth.Store
	cookieSecure bool
	logger       *slog.Logger
}

func newAuthHandler(store *auth.Store, cookieSecure bool, logger *slog.Logger) *authHandler {
	return &authHandler{
		store:        store,
		cookieSecure: cookieSecure,
		logger:       logger,
	}
}

// getSession 处理 GET /api/auth/session，恢复有效用户会话；若携带过期、无效或已停用用户的 Cookie 则下发清除指令。
func (h *authHandler) getSession(c *gin.Context) {
	token, hasCookie := readSessionCookie(c.Request)
	user, err := h.store.GetSession(c.Request.Context(), token)
	if err != nil {
		h.logger.Error("getSession failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	if user == nil && hasCookie {
		clearSessionCookie(c, h.cookieSecure)
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// login 处理 POST /api/auth/login，完成请求体校验并委托 auth.Store 执行限流、凭据验证与会话轮换。
func (h *authHandler) login(c *gin.Context) {
	username, password, status, msg := readLoginBody(c)
	if status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	previousToken, _ := readSessionCookie(c.Request)
	user, newToken, err := h.store.Login(c.Request.Context(), username, password, previousToken)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrRateLimited):
			c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
		case errors.Is(err, auth.ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		case errors.Is(err, auth.ErrUserDisabled):
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		default:
			h.logger.Error("login failed", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		}
		return
	}

	setSessionCookie(c, newToken, auth.SessionMaxAgeSeconds, h.cookieSecure)
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// changePassword 处理 POST /api/auth/change-password，允许已登录用户校验当前密码后自助改密，
// 清除 must_change_password 标记，轮换当前会话并吊销同账号其他全部会话。
func (h *authHandler) changePassword(c *gin.Context) {
	user, ok := mustAuthUser(c)
	if !ok {
		return
	}
	currentPassword, newPassword, status, msg := readChangePasswordBody(c)
	if status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	updatedUser, newToken, err := h.store.ChangePassword(c.Request.Context(), user.ID, currentPassword, newPassword)
	if err != nil {
		var valErr *auth.ValidationError
		switch {
		case errors.Is(err, auth.ErrRateLimited):
			c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
		case errors.As(err, &valErr):
			c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
		case errors.Is(err, auth.ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "当前密码不正确", "code": "INVALID_CREDENTIALS"})
		case errors.Is(err, auth.ErrUserDisabled):
			clearSessionCookie(c, h.cookieSecure)
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case errors.Is(err, auth.ErrUserNotFound):
			clearSessionCookie(c, h.cookieSecure)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		default:
			h.logger.Error("changePassword failed", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		}
		return
	}

	setSessionCookie(c, newToken, auth.SessionMaxAgeSeconds, h.cookieSecure)
	c.JSON(http.StatusOK, gin.H{"user": updatedUser})
}

// logout 处理 POST /api/auth/logout，仅吊销当前调用方的会话并清除客户端 Cookie。
func (h *authHandler) logout(c *gin.Context) {
	token, _ := readSessionCookie(c.Request)
	if err := h.store.RevokeSession(c.Request.Context(), token); err != nil {
		h.logger.Error("revokeSession failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	clearSessionCookie(c, h.cookieSecure)
	c.JSON(http.StatusOK, gin.H{"user": nil})
}

func readSessionCookie(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err != nil {
		return "", false
	}
	return cookie.Value, true
}

// setSessionCookie 下发会话 Cookie：
// HttpOnly 防脚本窃取，SameSite=Strict 防跨站携带，Secure 在直连 TLS 或显式配置 BABYLOG_COOKIE_SECURE=true 时开启。
func setSessionCookie(c *gin.Context, token string, maxAge int, forceSecure bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   forceSecure || c.Request.TLS != nil,
	})
}

func clearSessionCookie(c *gin.Context, forceSecure bool) {
	setSessionCookie(c, "", -1, forceSecure)
}

func readStrictJSONObject(c *gin.Context, wrongCTMsg, badJSONMsg, badShapeMsg string) (map[string]any, int, string) {
	body, status, msg := readJSONBytes(c, maxAuthBodyBytes, wrongCTMsg)
	if status != 0 {
		return nil, status, msg
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, http.StatusBadRequest, badJSONMsg
	}
	obj, ok := payload.(map[string]any)
	if !ok || obj == nil {
		return nil, http.StatusBadRequest, badShapeMsg
	}
	return obj, 0, ""
}

// readLoginBody 严格解析并校验登录 JSON 请求体，拒绝缺失字段或非字符串类型，并原样保留密码中的空白字符。
func readLoginBody(c *gin.Context) (username, password string, errStatus int, errMsg string) {
	obj, status, msg := readStrictJSONObject(c, "请使用 JSON 格式提交登录信息", "登录信息不是有效的 JSON", "请输入有效的用户名和密码")
	if status != 0 {
		return "", "", status, msg
	}

	rawUser, userOK := obj["username"].(string)
	rawPass, passOK := obj["password"].(string)
	if !userOK || !passOK ||
		utf8.RuneCountInString(rawUser) > auth.MaxUsernameLength ||
		utf8.RuneCountInString(rawPass) > auth.MaxPasswordLength {
		return "", "", http.StatusBadRequest, "请输入有效的用户名和密码"
	}

	return rawUser, rawPass, 0, ""
}

// readChangePasswordBody 严格解析自助改密 JSON 载荷（current_password / new_password），拒绝多余字段与非字符串。
func readChangePasswordBody(c *gin.Context) (currentPassword, newPassword string, errStatus int, errMsg string) {
	obj, status, msg := readStrictJSONObject(c, "请使用 JSON 格式提交数据", "请求数据格式不正确", "请输入有效的当前密码和新密码")
	if status != 0 {
		return "", "", status, msg
	}
	if len(obj) != 2 {
		return "", "", http.StatusBadRequest, "请求数据格式不正确"
	}
	cur, curOK := obj["current_password"].(string)
	next, nextOK := obj["new_password"].(string)
	if !curOK || !nextOK ||
		utf8.RuneCountInString(cur) > auth.MaxPasswordLength ||
		utf8.RuneCountInString(next) > auth.MaxPasswordLength {
		return "", "", http.StatusBadRequest, "请输入有效的当前密码和新密码"
	}
	return cur, next, 0, ""
}
