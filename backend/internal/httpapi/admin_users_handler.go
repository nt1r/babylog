package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/auth"
)

// adminUsersHandler 处理唯一管理员的普通用户生命周期管理接口（列表、创建、启停用、重置密码），
// 严格遵循隐私隔离边界，仅操作 users / sessions 账号元数据，不触碰任何宝宝或育儿业务表。
type adminUsersHandler struct {
	store  *auth.Store
	logger *slog.Logger
}

func newAdminUsersHandler(store *auth.Store, logger *slog.Logger) *adminUsersHandler {
	return &adminUsersHandler{
		store:  store,
		logger: logger,
	}
}

func (h *adminUsersHandler) registerRoutes(group *gin.RouterGroup) {
	group.GET("", h.listUsers)
	group.POST("", h.createUser)
	group.PATCH("/:id", h.updateUser)
	group.POST("/:id/reset-password", h.resetPassword)
}

func (h *adminUsersHandler) handleErr(c *gin.Context, op string, err error) {
	var valErr *auth.ValidationError
	switch {
	case errors.Is(err, auth.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
	case errors.As(err, &valErr):
		c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
	case errors.Is(err, auth.ErrAdminProtected):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, auth.ErrUsernameExists):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, auth.ErrUserNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	default:
		h.logger.Error(op+" failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
	}
}

// listUsers 处理 GET /api/admin/users，返回全部用户的非敏感账号元数据（不含宝宝或记录数）。
func (h *adminUsersHandler) listUsers(c *gin.Context) {
	users, err := h.store.ListUsers(c.Request.Context())
	if err != nil {
		h.handleErr(c, "listUsers", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

// createUser 处理 POST /api/admin/users，创建普通用户并默认标记 must_change_password = true。
func (h *adminUsersHandler) createUser(c *gin.Context) {
	obj, status, msg := readStrictJSONObject(c, "请使用 JSON 格式提交数据", "请求数据格式不正确", "请输入有效的用户名和初始密码")
	if status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	if len(obj) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	username, userOK := obj["username"].(string)
	password, passOK := obj["password"].(string)
	if !userOK || !passOK {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入有效的用户名和初始密码"})
		return
	}

	created, err := h.store.CreateUser(c.Request.Context(), username, password, true)
	if err != nil {
		h.handleErr(c, "createUser", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user": created})
}

// updateUser 处理 PATCH /api/admin/users/:id，切换普通用户的停用/启用状态并在停用时立即吊销全部会话。
func (h *adminUsersHandler) updateUser(c *gin.Context) {
	id, ok := parsePositiveIntParam(c, "id", "无效的用户编号")
	if !ok {
		return
	}
	var input struct {
		Disabled *bool `json:"disabled"`
	}
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	if input.Disabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定账号停用状态"})
		return
	}

	updated, err := h.store.SetUserDisabledByID(c.Request.Context(), id, *input.Disabled)
	if err != nil {
		h.handleErr(c, "updateUser", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": updated})
}

// resetPassword 处理 POST /api/admin/users/:id/reset-password，为普通用户重置临时密码，
// 置位 must_change_password = true 并立即吊销其全部活跃会话。
func (h *adminUsersHandler) resetPassword(c *gin.Context) {
	id, ok := parsePositiveIntParam(c, "id", "无效的用户编号")
	if !ok {
		return
	}
	obj, status, msg := readStrictJSONObject(c, "请使用 JSON 格式提交数据", "请求数据格式不正确", "请输入有效的新密码")
	if status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	if len(obj) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	password, passOK := obj["password"].(string)
	if !passOK {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入有效的新密码"})
		return
	}

	updated, err := h.store.ResetUserPasswordByID(c.Request.Context(), id, password, true)
	if err != nil {
		h.handleErr(c, "resetUserPassword", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": updated})
}
