package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/baby"
)

type babyHandler struct {
	store  *baby.Store
	logger *slog.Logger
}

func newBabyHandler(store *baby.Store, logger *slog.Logger) *babyHandler {
	return &babyHandler{store: store, logger: logger}
}

// handleErr 统一将 baby 领域层校验与查询错误映射为中文 JSON HTTP 响应。
func (h *babyHandler) handleErr(c *gin.Context, op string, err error) {
	var valErr *baby.ValidationError
	if errors.As(err, &valErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
		return
	}
	if errors.Is(err, baby.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	h.logger.Error(op+" failed", "error", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
}

// listProfiles 处理 GET /api/babies，返回当前登录用户归属的全部宝宝档案列表（按 id 升序）。
func (h *babyHandler) listProfiles(c *gin.Context) {
	user, ok := mustAuthUser(c)
	if !ok {
		return
	}
	profiles, err := h.store.ListByUser(c.Request.Context(), user.ID)
	if err != nil {
		h.handleErr(c, "listBabyProfiles", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"babies": profiles})
}

// createProfile 处理 POST /api/babies，为当前登录用户新建宝宝档案（最多 10 个）。
func (h *babyHandler) createProfile(c *gin.Context) {
	user, ok := mustAuthUser(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	var input baby.UpsertInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	profile, err := h.store.CreateForUser(c.Request.Context(), user.ID, input, loc)
	if err != nil {
		h.handleErr(c, "createBabyProfile", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"baby": profile})
}

// updateProfile 处理 PUT /api/babies/:babyId，更新归属于当前用户的指定宝宝档案。
func (h *babyHandler) updateProfile(c *gin.Context) {
	user, ok := mustAuthUser(c)
	if !ok {
		return
	}
	babyID, ok := parsePositiveIntParam(c, "babyId", "无效的宝宝编号")
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	var input baby.UpsertInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	profile, err := h.store.UpdateForUser(c.Request.Context(), user.ID, babyID, input, loc)
	if err != nil {
		h.handleErr(c, "updateBabyProfile", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"baby": profile})
}

// deleteProfile 处理 DELETE /api/babies/:babyId，硬删除归属于当前用户的宝宝档案并级联清空全部子表记录。
func (h *babyHandler) deleteProfile(c *gin.Context) {
	user, ok := mustAuthUser(c)
	if !ok {
		return
	}
	babyID, ok := parsePositiveIntParam(c, "babyId", "无效的宝宝编号")
	if !ok {
		return
	}
	if err := h.store.DeleteForUser(c.Request.Context(), user.ID, babyID); err != nil {
		h.handleErr(c, "deleteBabyProfile", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// updateDefaultClinic 处理 PUT /api/babies/:babyId/vaccines/default-clinic，单独更新或清空归属宝宝的常去接种门诊名称。
func (h *babyHandler) updateDefaultClinic(c *gin.Context) {
	user, ok := mustAuthUser(c)
	if !ok {
		return
	}
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	var input struct {
		ClinicName string `json:"clinic_name"`
	}
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	updated, err := h.store.UpdateDefaultClinic(c.Request.Context(), user.ID, babyID, input.ClinicName)
	if err != nil {
		h.handleErr(c, "updateDefaultClinic", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"default_clinic_name": updated})
}
