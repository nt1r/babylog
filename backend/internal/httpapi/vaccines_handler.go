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

// vaccinesHandler 处理疫苗接种计划、模板库、自定义添加、单剂更新、批量操作与删除接口。
// 路由组已挂载 requireBabyProfileMiddleware（注入完整宝宝档案），处理器直接透传 *baby.Profile 给 vaccines.Store。
type vaccinesHandler struct {
	store  *vaccines.Store
	logger *slog.Logger
}

func newVaccinesHandler(store *vaccines.Store, logger *slog.Logger) *vaccinesHandler {
	return &vaccinesHandler{
		store:  store,
		logger: logger,
	}
}

// registerRoutes 注册疫苗路由；静态子路径显式排在 /:id 之前，避免路由语义歧义。
func (h *vaccinesHandler) registerRoutes(group *gin.RouterGroup) {
	group.GET("", h.getOverview)
	group.GET("/catalog", h.getCatalog)
	group.POST("/from-template", h.addFromTemplate)
	group.POST("/batch", h.batchUpdate)
	group.POST("", h.createCustom)
	group.PUT("/:id", h.updateDose)
	group.DELETE("/template/:code", h.deleteTemplate)
	group.DELETE("/:id", h.deleteDose)
}

// parseBabyTimezoneContext 统一提取中间件注入的宝宝档案上下文与请求 IANA 时区，避免各处理器重复校验样板。
func parseBabyTimezoneContext(c *gin.Context) (*baby.Profile, *time.Location, bool) {
	profile, ok := mustBabyProfile(c)
	if !ok {
		return nil, nil, false
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return nil, nil, false
	}
	return profile, loc, true
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
	profile, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	overview, err := h.store.GetOverview(c.Request.Context(), profile, loc)
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
	profile, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	var input vaccines.AddTemplateInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	doses, err := h.store.AddFromTemplate(c.Request.Context(), profile, loc, input)
	if err != nil {
		h.handleErr(c, "addVaccineTemplate", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"doses": doses})
}

// createCustom 处理 POST /api/vaccines，新增单剂或多剂自定义疫苗（201）。
func (h *vaccinesHandler) createCustom(c *gin.Context) {
	profile, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	var input vaccines.CreateCustomInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	doses, err := h.store.CreateCustom(c.Request.Context(), profile, loc, input)
	if err != nil {
		h.handleErr(c, "createCustomVaccine", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"doses": doses})
}

// updateDose 处理 PUT /api/vaccines/:id，更新单剂状态、排期、预约或接种记录（200 / 404）。
func (h *vaccinesHandler) updateDose(c *gin.Context) {
	profile, loc, ok := parseBabyTimezoneContext(c)
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
	dose, err := h.store.UpdateDose(c.Request.Context(), profile, id, loc, input)
	if err != nil {
		h.handleErr(c, "updateVaccineDose", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"dose": dose})
}

// batchUpdate 处理 POST /api/vaccines/batch，在单事务内批量预约或批量标记已接种（200 / 404）。
func (h *vaccinesHandler) batchUpdate(c *gin.Context) {
	profile, loc, ok := parseBabyTimezoneContext(c)
	if !ok {
		return
	}
	var input vaccines.BatchUpdateInput
	if status, msg := decodeJSONBody(c, &input); status != 0 {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	doses, err := h.store.BatchUpdate(c.Request.Context(), profile, loc, input)
	if err != nil {
		h.handleErr(c, "batchUpdateVaccines", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"doses": doses})
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
