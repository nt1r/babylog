package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/dashboard"
)

// dashboardHandler 处理首页看板今日汇总与近 N 日趋势聚合接口。
// 路由组已挂载 requireBabyProfileMiddleware，前置校验宝宝已完成建档。
type dashboardHandler struct {
	svc    *dashboard.Service
	logger *slog.Logger
}

func newDashboardHandler(svc *dashboard.Service, logger *slog.Logger) *dashboardHandler {
	return &dashboardHandler{
		svc:    svc,
		logger: logger,
	}
}

// getSummary 处理 GET /api/dashboard/summary，按指定 IANA 时区返回今日 KPI 与距上次照护时间戳。
func (h *dashboardHandler) getSummary(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}
	res, err := h.svc.GetSummary(c.Request.Context(), babyID, loc)
	if err != nil {
		h.logError("dashboard getSummary failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusOK, res)
}

// getTrends 处理 GET /api/dashboard/trends，返回连续 days 天的奶量/睡眠趋势与 5 时段照护节律。
func (h *dashboardHandler) getTrends(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	days := 7
	if rawDays := strings.TrimSpace(c.Query("days")); rawDays != "" {
		parsed, err := strconv.Atoi(rawDays)
		if err != nil || parsed < 1 || parsed > 90 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "趋势天数应在 1 至 90 之间"})
			return
		}
		days = parsed
	}

	res, err := h.svc.GetTrends(c.Request.Context(), babyID, days, loc)
	if err != nil {
		h.logError("dashboard getTrends failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *dashboardHandler) logError(msg string, err error) {
	if h.logger != nil {
		h.logger.Error(msg, "error", err)
	}
}
