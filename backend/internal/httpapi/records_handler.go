package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/records"
)

// recordsHandler 处理喂养、睡眠、护理、健康四类记录的 CRUD 与智能默认值接口。
// 路由组已挂载 requireBabyProfileMiddleware，因此各处理器直接从上下文获取已校验的 babyID。
type recordsHandler struct {
	recordStore *records.Store
	logger      *slog.Logger
}

func newRecordsHandler(recordStore *records.Store, logger *slog.Logger) *recordsHandler {
	return &recordsHandler{
		recordStore: recordStore,
		logger:      logger,
	}
}

func (h *recordsHandler) handleRecordErr(c *gin.Context, op string, err error) {
	var valErr *records.ValidationError
	if errors.As(err, &valErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
		return
	}
	if errors.Is(err, records.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if h.logger != nil {
		h.logger.Error(op+" failed", "error", err)
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
}

// ==================== Feeding ====================

func (h *recordsHandler) listFeeding(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	filter, ok := parseListFilter(c)
	if !ok {
		return
	}
	res, err := h.recordStore.ListFeeding(c.Request.Context(), babyID, filter)
	if err != nil {
		h.handleRecordErr(c, "listFeeding", err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *recordsHandler) createFeeding(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	var input records.FeedingInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.CreateFeeding(c.Request.Context(), babyID, input)
	if err != nil {
		h.handleRecordErr(c, "createFeeding", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"record": rec})
}

func (h *recordsHandler) updateFeeding(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var input records.FeedingInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.UpdateFeeding(c.Request.Context(), babyID, id, input)
	if err != nil {
		h.handleRecordErr(c, "updateFeeding", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"record": rec})
}

func (h *recordsHandler) deleteFeeding(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if err := h.recordStore.DeleteFeeding(c.Request.Context(), babyID, id); err != nil {
		h.handleRecordErr(c, "deleteFeeding", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ==================== Sleep ====================

func (h *recordsHandler) listSleep(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	filter, ok := parseListFilter(c)
	if !ok {
		return
	}
	res, err := h.recordStore.ListSleep(c.Request.Context(), babyID, filter)
	if err != nil {
		h.handleRecordErr(c, "listSleep", err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *recordsHandler) createSleep(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	var input records.SleepInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.CreateSleep(c.Request.Context(), babyID, input)
	if err != nil {
		h.handleRecordErr(c, "createSleep", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"record": rec})
}

func (h *recordsHandler) updateSleep(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var input records.SleepInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.UpdateSleep(c.Request.Context(), babyID, id, input)
	if err != nil {
		h.handleRecordErr(c, "updateSleep", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"record": rec})
}

func (h *recordsHandler) deleteSleep(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if err := h.recordStore.DeleteSleep(c.Request.Context(), babyID, id); err != nil {
		h.handleRecordErr(c, "deleteSleep", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ==================== Care ====================

func (h *recordsHandler) listCare(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	filter, ok := parseListFilter(c)
	if !ok {
		return
	}
	res, err := h.recordStore.ListCare(c.Request.Context(), babyID, filter)
	if err != nil {
		h.handleRecordErr(c, "listCare", err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *recordsHandler) createCare(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	var input records.CareInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.CreateCare(c.Request.Context(), babyID, input)
	if err != nil {
		h.handleRecordErr(c, "createCare", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"record": rec})
}

func (h *recordsHandler) updateCare(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var input records.CareInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.UpdateCare(c.Request.Context(), babyID, id, input)
	if err != nil {
		h.handleRecordErr(c, "updateCare", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"record": rec})
}

func (h *recordsHandler) deleteCare(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if err := h.recordStore.DeleteCare(c.Request.Context(), babyID, id); err != nil {
		h.handleRecordErr(c, "deleteCare", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ==================== Health ====================

func (h *recordsHandler) listHealth(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	filter, ok := parseListFilter(c)
	if !ok {
		return
	}
	res, err := h.recordStore.ListHealth(c.Request.Context(), babyID, filter)
	if err != nil {
		h.handleRecordErr(c, "listHealth", err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *recordsHandler) createHealth(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	var input records.HealthInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.CreateHealth(c.Request.Context(), babyID, input)
	if err != nil {
		h.handleRecordErr(c, "createHealth", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"record": rec})
}

func (h *recordsHandler) updateHealth(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var input records.HealthInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rec, err := h.recordStore.UpdateHealth(c.Request.Context(), babyID, id, input)
	if err != nil {
		h.handleRecordErr(c, "updateHealth", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"record": rec})
}

func (h *recordsHandler) deleteHealth(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if err := h.recordStore.DeleteHealth(c.Request.Context(), babyID, id); err != nil {
		h.handleRecordErr(c, "deleteHealth", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ==================== Smart Defaults ====================

// getDefaults 处理 GET /api/records/defaults，汇总返回前端快捷录入所需的智能默认值。
func (h *recordsHandler) getDefaults(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	defaults, err := h.recordStore.GetSmartDefaults(c.Request.Context(), babyID)
	if err != nil {
		h.handleRecordErr(c, "getDefaults", err)
		return
	}
	c.JSON(http.StatusOK, defaults)
}
