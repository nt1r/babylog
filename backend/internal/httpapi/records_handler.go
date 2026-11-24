package httpapi

import (
	"context"
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

// handleRecordErr 将 records 领域错误统一映射为 HTTP 状态码与中文 JSON：
// errors.As 匹配带自定义消息的 [*records.ValidationError]（400），errors.Is 匹配哨兵错误 [records.ErrNotFound]（404），
// 其余未预期底层错误仅记录脱敏日志并返回 500。
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
	h.logger.Error(op+" failed", "error", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
}

// recordCRUD 是泛型 CRUD 方法集（类型参数 Rec=记录模型、In=写入载荷、Sum=每日小计），
// 用于将四类记录各自的 Store 方法绑定到统一的路由注册模板 `registerRecordRoutes`。
type recordCRUD[Rec any, In any, Sum any] struct {
	opPrefix string
	list     func(context.Context, int64, records.ListFilter) (*records.ListResult[Rec, Sum], error)
	create   func(context.Context, int64, In) (*Rec, error)
	update   func(context.Context, int64, int64, In) (*Rec, error)
	delete   func(context.Context, int64, int64) error
}

// registerRecordRoutes 将单类记录的 GET/POST/PUT/DELETE 统一注册到路由组，
// 保持四类记录的 JSON 解码、参数校验、状态码与错误处理语义完全一致。
func registerRecordRoutes[Rec any, In any, Sum any](
	group *gin.RouterGroup,
	path string,
	h *recordsHandler,
	crud recordCRUD[Rec, In, Sum],
) {
	group.GET(path, func(c *gin.Context) {
		babyID, ok := mustBabyID(c)
		if !ok {
			return
		}
		filter, ok := parseListFilter(c)
		if !ok {
			return
		}
		res, err := crud.list(c.Request.Context(), babyID, filter)
		if err != nil {
			h.handleRecordErr(c, "list"+crud.opPrefix, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	group.POST(path, func(c *gin.Context) {
		babyID, ok := mustBabyID(c)
		if !ok {
			return
		}
		var input In
		if status, msg := decodeJSONBody(c, &input); status != 0 {
			c.JSON(status, gin.H{"error": msg})
			return
		}
		rec, err := crud.create(c.Request.Context(), babyID, input)
		if err != nil {
			h.handleRecordErr(c, "create"+crud.opPrefix, err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"record": rec})
	})

	group.PUT(path+"/:id", func(c *gin.Context) {
		babyID, ok := mustBabyID(c)
		if !ok {
			return
		}
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		var input In
		if status, msg := decodeJSONBody(c, &input); status != 0 {
			c.JSON(status, gin.H{"error": msg})
			return
		}
		rec, err := crud.update(c.Request.Context(), babyID, id, input)
		if err != nil {
			h.handleRecordErr(c, "update"+crud.opPrefix, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"record": rec})
	})

	group.DELETE(path+"/:id", func(c *gin.Context) {
		babyID, ok := mustBabyID(c)
		if !ok {
			return
		}
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		if err := crud.delete(c.Request.Context(), babyID, id); err != nil {
			h.handleRecordErr(c, "delete"+crud.opPrefix, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": true})
	})
}

// registerRoutes 挂载智能默认值及四类日常记录的标准 CRUD 路由。
// 传入的 `h.recordStore.ListFeeding` 等属于 Go 的“方法值”（Method Value），已自动绑定接收者实例，无需再套匿名闭包。
func (h *recordsHandler) registerRoutes(group *gin.RouterGroup) {
	group.GET("/defaults", h.getDefaults)

	registerRecordRoutes(group, "/feeding", h, recordCRUD[records.FeedingRecord, records.FeedingInput, records.FeedingDailySummary]{
		opPrefix: "Feeding",
		list:     h.recordStore.ListFeeding,
		create:   h.recordStore.CreateFeeding,
		update:   h.recordStore.UpdateFeeding,
		delete:   h.recordStore.DeleteFeeding,
	})
	registerRecordRoutes(group, "/sleep", h, recordCRUD[records.SleepRecord, records.SleepInput, records.SleepDailySummary]{
		opPrefix: "Sleep",
		list:     h.recordStore.ListSleep,
		create:   h.recordStore.CreateSleep,
		update:   h.recordStore.UpdateSleep,
		delete:   h.recordStore.DeleteSleep,
	})
	registerRecordRoutes(group, "/care", h, recordCRUD[records.CareRecord, records.CareInput, records.CareDailySummary]{
		opPrefix: "Care",
		list:     h.recordStore.ListCare,
		create:   h.recordStore.CreateCare,
		update:   h.recordStore.UpdateCare,
		delete:   h.recordStore.DeleteCare,
	})
	registerRecordRoutes(group, "/health", h, recordCRUD[records.HealthRecord, records.HealthInput, records.HealthDailySummary]{
		opPrefix: "Health",
		list:     h.recordStore.ListHealth,
		create:   h.recordStore.CreateHealth,
		update:   h.recordStore.UpdateHealth,
		delete:   h.recordStore.DeleteHealth,
	})
}

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
