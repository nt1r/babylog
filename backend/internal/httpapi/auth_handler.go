package httpapi

import (
	"encoding/json"
	"log/slog"
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
		h.logger.Error("getSession failed", "error", err)
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
		h.logger.Error("authenticate failed", "error", err)
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
		h.logger.Error("createSession failed", "error", err)
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
		h.logger.Error("revokeSession failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	clearSessionCookie(c)
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
// HttpOnly 防止前端脚本窃取，SameSite=Strict 防御跨站请求携带，Secure 在直连 TLS 时自动开启。
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
// 此处反序列化为 any 再手工断言 map[string]any 与 string（而非直接解到 struct），
// 因为 Go 结构体反序列化会把缺失键或 JSON null 静默置为零值 ""，无法严格拒绝缺失字段或非字符串类型；
// 同时保留密码原始空白字符不做 TrimSpace。
func readLoginBody(c *gin.Context) (username, password string, errStatus int, errMsg string) {
	body, status, msg := readJSONBytes(c, maxLoginBodyBytes, "请使用 JSON 格式提交登录信息")
	if status != 0 {
		return "", "", status, msg
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
