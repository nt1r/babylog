package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// vaccinesHandler 处理疫苗接种计划、模板库、常去接种门诊、自定义添加、单剂更新、批量操作与删除接口。
// 路由组已挂载 requireBabyProfileMiddleware（注入完整宝宝档案），处理器直接从上下文读取档案信息，
// 并注入 babyStore 供 PUT /api/vaccines/default-clinic 复用档案持久化。
type vaccinesHandler struct {
	store     *vaccines.Store
	babyStore *baby.Store
	logger    *slog.Logger
}

func newVaccinesHandler(store *vaccines.Store, babyStore *baby.Store, logger *slog.Logger) *vaccinesHandler {
	return &vaccinesHandler{
		store:     store,
		babyStore: babyStore,
		logger:    logger,
	}
}

// registerRoutes 注册疫苗路由；静态子路径显式排在 /:id 之前，避免路由语义歧义。
func (h *vaccinesHandler) registerRoutes(group *gin.RouterGroup) {
	group.GET("", h.getOverview)
	group.GET("/catalog", h.getCatalog)
	group.PUT("/default-clinic", h.updateDefaultClinic)
	group.POST("/from-template", h.addFromTemplate)
	group.POST("/batch", h.batchUpdate)
	group.POST("", h.createCustom)
	group.PUT("/:id", h.updateDose)
	group.DELETE("/template/:code", h.deleteTemplate)
	group.DELETE("/:id", h.deleteDose)
}

// parseBabyTimezoneContext 统一提取中间件注入的宝宝档案上下文与请求 IANA 时区，避免各处理器重复校验样板。
func parseBabyTimezoneContext(c *gin.Context) (int64, string, *time.Location, bool) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return 0, "", nil, false
	}
	birthDate, ok := mustBabyBirthDate(c)
	if !ok {
		return 0, "", nil, false
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return 0, "", nil, false
	}
	return babyID, birthDate, loc, true
}

// handleErr 将 vaccines 领域错误统一映射为中文 HTTP 状态码（400/404/409/500）。
func (h *vaccinesHandler) handleErr(c *gin.Context, op string, err error) {
	var valErr *vaccines.ValidationError
	if errors.As(err, &valErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": valErr.Error()})
		return
	}
	if errors.Is(err, vaccines.ErrCannotDeleteNIP) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, vaccines.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, vaccines.ErrTemplateAlreadyAdded) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	h.logger.Error(op+" failed", "error", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
}

// getOverview 处理 GET /api/vaccines，按请求时区返回完整疫苗计划与提醒概览（200）。
func (h *vaccinesHandler) getOverview(c *gin.Context) {
	profile, ok := mustBabyProfile(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}
	overview, err := h.store.GetOverview(c.Request.Context(), profile.ID, profile.BirthDate, profile.DefaultClinicName, loc)
	if err != nil {
		h.handleErr(c, "getVaccineOverview", err)
		return
	}
	c.JSON(http.StatusOK, overview)
}

// getCatalog 处理 GET /api/vaccines/catalog，返回内置自费疫苗模板库及已加入状态（200）。
func (h *vaccinesHandler) getCatalog(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	catalog, err := h.store.GetOptionalCatalog(c.Request.Context(), babyID)
	if err != nil {
		h.handleErr(c, "getVaccineCatalog", err)
		return
	}
	c.JSON(http.StatusOK, catalog)
}

// addFromTemplate 处理 POST /api/vaccines/from-template，按默认或定制排期导入自费模板（201 / 409）。
func (h *vaccinesHandler) addFromTemplate(c *gin.Context) {
	babyID, birthDate, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	var input vaccines.AddTemplateInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	doses, err := h.store.AddFromTemplate(c.Request.Context(), babyID, birthDate, loc, input)
	if err != nil {
		h.handleErr(c, "addVaccineTemplate", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"doses": doses})
}

// createCustom 处理 POST /api/vaccines，新增单剂或多剂自定义疫苗（201）。
func (h *vaccinesHandler) createCustom(c *gin.Context) {
	babyID, birthDate, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	var input vaccines.CreateCustomInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	doses, err := h.store.CreateCustom(c.Request.Context(), babyID, birthDate, loc, input)
	if err != nil {
		h.handleErr(c, "createCustomVaccine", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"doses": doses})
}

// updateDose 处理 PUT /api/vaccines/:id，更新单剂状态、排期、预约或接种记录（200 / 404）。
func (h *vaccinesHandler) updateDose(c *gin.Context) {
	babyID, birthDate, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var input vaccines.UpdateDoseInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	dose, err := h.store.UpdateDose(c.Request.Context(), babyID, id, birthDate, loc, input)
	if err != nil {
		h.handleErr(c, "updateVaccineDose", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"dose": dose})
}

// batchUpdate 处理 POST /api/vaccines/batch，在单事务内批量预约或批量标记已接种（200 / 404）。
func (h *vaccinesHandler) batchUpdate(c *gin.Context) {
	babyID, birthDate, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	var input vaccines.BatchUpdateInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	doses, err := h.store.BatchUpdate(c.Request.Context(), babyID, birthDate, loc, input)
	if err != nil {
		h.handleErr(c, "batchUpdateVaccines", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"doses": doses})
}

// updateDefaultClinic 处理 PUT /api/vaccines/default-clinic：
// 路由归属疫苗工作区以便直接行内设置常去门诊，底层字段归属单宝宝档案因此委派给 babyStore 持久化。
func (h *vaccinesHandler) updateDefaultClinic(c *gin.Context) {
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
	updated, err := h.babyStore.UpdateDefaultClinic(c.Request.Context(), babyID, input.ClinicName)
	if err != nil {
		handleBabyStoreError(c, h.logger, "updateDefaultClinic", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"default_clinic_name": updated})
}

// deleteTemplate 处理 DELETE /api/vaccines/template/:code，整套移出已加入的自费模板（200 / 400 / 404）。
func (h *vaccinesHandler) deleteTemplate(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	if err := h.store.DeleteTemplate(c.Request.Context(), babyID, c.Param("code")); err != nil {
		h.handleErr(c, "deleteVaccineTemplate", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// deleteDose 处理 DELETE /api/vaccines/:id，删除单剂自定义或自费剂次并重排剩余编号（200 / 400 / 404）。
func (h *vaccinesHandler) deleteDose(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if err := h.store.DeleteDose(c.Request.Context(), babyID, id); err != nil {
		h.handleErr(c, "deleteVaccineDose", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
