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
// 路由组已挂载 requireBabyProfileMiddleware（注入完整宝宝档案），处理器直接从上下文读取 babyID 与 birthDate。
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

// handleErr 将领域层错误映射为统一的中文 HTTP 状态码与 JSON 响应：
// errors.As 沿错误包装链提取具体自定义错误类型（*[vaccines.ValidationError]），
// errors.Is 则按值匹配包级哨兵错误（如 [vaccines.ErrNotFound]）。
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
