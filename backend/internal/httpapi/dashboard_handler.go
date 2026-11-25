package httpapi

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/dashboard"
)

// dashboardHandler 处理首页看板今日汇总与近 N 日趋势聚合接口。
// 路由组已挂载 requireBabyOwnershipMiddleware，前置校验目标宝宝归属于当前登录用户。
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

// getSummary 处理 GET /api/babies/:babyId/dashboard/summary，按指定 IANA 时区返回今日 KPI、健康观察与生长概览。
func (h *dashboardHandler) getSummary(c *gin.Context) {
	profile, ok := mustBabyProfile(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}
	baseline := &dashboard.BirthBaseline{
		BirthDate: profile.BirthDate,
		WeightKg:  profile.BirthWeightKg,
		HeightCm:  profile.BirthHeightCm,
	}
	res, err := h.svc.GetSummary(c.Request.Context(), profile.ID, loc, baseline)
	if err != nil {
		h.logger.Error("dashboard getSummary failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusOK, res)
}

// getTrends 处理 GET /api/babies/:babyId/dashboard/trends，返回连续 days 天的奶量/睡眠趋势与 5 时段照护节律。
func (h *dashboardHandler) getTrends(c *gin.Context) {
	babyID, ok := mustBabyID(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	days := dashboard.DefaultTrendDays
	if rawDays := strings.TrimSpace(c.Query("days")); rawDays != "" {
		parsed, err := strconv.Atoi(rawDays)
		if err != nil || parsed < dashboard.MinTrendDays || parsed > dashboard.MaxTrendDays {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("趋势天数应在 %d 至 %d 之间", dashboard.MinTrendDays, dashboard.MaxTrendDays),
			})
			return
		}
		days = parsed
	}

	res, err := h.svc.GetTrends(c.Request.Context(), babyID, days, loc)
	if err != nil {
		h.logger.Error("dashboard getTrends failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}
	c.JSON(http.StatusOK, res)
}
