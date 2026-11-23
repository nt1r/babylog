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

// getProfile 处理 GET /api/baby；未建档时返回 200 {baby: null}，供前端判定是否触发首次建档门禁。
func (h *babyHandler) getProfile(c *gin.Context) {
	profile, err := h.store.GetFirst(c.Request.Context())
	if err != nil {
		h.logger.Error("getBabyProfile failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"baby": profile})
}

// createProfile 处理 POST /api/baby；单宝宝模式下若已存在档案则返回 409 Conflict 拒绝重复建档。
func (h *babyHandler) createProfile(c *gin.Context) {
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	var input baby.UpsertInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	profile, err := h.store.Create(c.Request.Context(), input, loc)
	if err != nil {
		var valErr *baby.ValidationError
		if errors.As(err, &valErr) {
			c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
			return
		}
		if errors.Is(err, baby.ErrAlreadyExists) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		h.logger.Error("createBabyProfile failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"baby": profile})
}

// updateProfile 处理 PUT /api/baby；尚未建档时目标资源不存在，返回 404 Not Found。
func (h *babyHandler) updateProfile(c *gin.Context) {
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	var input baby.UpsertInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}

	profile, err := h.store.Update(c.Request.Context(), input, loc)
	if err != nil {
		var valErr *baby.ValidationError
		if errors.As(err, &valErr) {
			c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
			return
		}
		if errors.Is(err, baby.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		h.logger.Error("updateBabyProfile failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"baby": profile})
}
