package httpapi

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/export"
)

// exportHandler 处理宝宝照护数据的多 Sheet Excel（.xlsx）导出下载接口。
// 路由组已挂载 requireBabyOwnershipMiddleware，前置校验目标宝宝归属于当前登录用户。
type exportHandler struct {
	svc    *export.Service
	logger *slog.Logger
}

func newExportHandler(svc *export.Service, logger *slog.Logger) *exportHandler {
	return &exportHandler{
		svc:    svc,
		logger: logger,
	}
}

// exportXLSX 处理 GET /api/babies/:babyId/export/xlsx，按指定时区、日期范围与分类返回标准 .xlsx 附件。
func (h *exportHandler) exportXLSX(c *gin.Context) {
	profile, ok := mustBabyProfile(c)
	if !ok {
		return
	}
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return
	}

	categoriesRaw, categoriesProvided := c.GetQuery("categories")
	res, err := h.svc.BuildXLSX(c.Request.Context(), export.Params{
		BabyID:             profile.ID,
		BabyNickname:       profile.Nickname,
		DaysRaw:            c.Query("days"),
		StartRaw:           c.Query("start"),
		EndRaw:             c.Query("end"),
		CategoriesRaw:      categoriesRaw,
		CategoriesProvided: categoriesProvided,
		Loc:                loc,
	})
	if err != nil {
		var ve *export.ValidationError
		if errors.As(err, &ve) {
			c.JSON(http.StatusBadRequest, gin.H{"error": ve.Message})
			return
		}
		h.logger.Error("exportXLSX failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`,
		res.FilenameASCII,
		url.PathEscape(res.FilenameUTF8),
	))
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", res.Content)
}
