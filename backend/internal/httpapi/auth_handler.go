package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
)

// maxLoginBodyBytes 限制登录请求体最大为 16 KiB，防止恶意超大载荷消耗内存。
const maxLoginBodyBytes = 16 * 1024

type authHandler struct {
	store  *auth.Store
	logger *slog.Logger
}

func newAuthHandler(store *auth.Store, logger *slog.Logger) *authHandler {
	return &authHandler{
		store:  store,
		logger: logger,
	}
}

// getSession 处理 GET /api/auth/session，恢复有效管理员会话；若携带过期或无效 Cookie 则下发清除指令。
func (h *authHandler) getSession(c *gin.Context) {
	token, hasCookie := readSessionCookie(c.Request)
	user, err := h.store.GetSession(c.Request.Context(), token)
	if err != nil {
		h.logInternalError("getSession failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	if user == nil && hasCookie {
		clearSessionCookie(c)
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// login 处理 POST /api/auth/login，完成请求体安全校验、凭据验证、会话轮换与 Cookie 签发。
func (h *authHandler) login(c *gin.Context) {
	username, password, status, msg := readLoginBody(c)
	if status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	user, err := h.store.Authenticate(c.Request.Context(), username, password)
	if err != nil {
		h.logInternalError("authenticate failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "账号或密码不正确"})
		return
	}

	previousToken, _ := readSessionCookie(c.Request)
	newToken, err := h.store.CreateSession(c.Request.Context(), previousToken)
	if err != nil {
		h.logInternalError("createSession failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}

	setSessionCookie(c, newToken, auth.SessionMaxAgeSeconds)
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// logout 处理 POST /api/auth/logout，吊销 SQLite 中的当前会话并清除客户端 Cookie。
func (h *authHandler) logout(c *gin.Context) {
	token, _ := readSessionCookie(c.Request)
	if err := h.store.RevokeSession(c.Request.Context(), token); err != nil {
		h.logInternalError("revokeSession failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	clearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"user": nil})
}

func (h *authHandler) logInternalError(msg string, err error) {
	if h.logger != nil {
		h.logger.Error(msg, "error", err)
	}
}

func readSessionCookie(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err != nil {
		return "", false
	}
	return cookie.Value, true
}

func setSessionCookie(c *gin.Context, token string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   c.Request.TLS != nil,
	})
}

func clearSessionCookie(c *gin.Context) {
	// Go net/http 中 MaxAge < 0 才会输出 Max-Age=0 以立即清除浏览器 Cookie。
	setSessionCookie(c, "", -1)
}

// readLoginBody 严格解析并校验登录 JSON 请求体。
// 这里不使用 Gin 的 ShouldBindJSON，目的是：
// 1. 精确区分 415（非 JSON Content-Type）、413（超出 16 KiB）与 400（格式/类型错误）；
// 2. 拒绝缺失字段、null 或非字符串类型（避免结构体零值把 null/缺字段误当作空字符串）；
// 3. 原样保留密码中的空白字符，不做隐式裁剪。
func readLoginBody(c *gin.Context) (username, password string, errStatus int, errMsg string) {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return "", "", http.StatusUnsupportedMediaType, "请使用 JSON 格式提交登录信息"
	}

	if c.Request.ContentLength > maxLoginBodyBytes {
		return "", "", http.StatusRequestEntityTooLarge, "请求内容过大"
	}

	limited := http.MaxBytesReader(c.Writer, c.Request.Body, maxLoginBodyBytes)
	body, err := io.ReadAll(limited)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return "", "", http.StatusRequestEntityTooLarge, "请求内容过大"
		}
		return "", "", http.StatusBadRequest, "请求内容读取失败"
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", "", http.StatusBadRequest, "登录信息不是有效的 JSON"
	}

	obj, ok := payload.(map[string]any)
	if !ok || obj == nil {
		return "", "", http.StatusBadRequest, "请输入有效的用户名和密码"
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
