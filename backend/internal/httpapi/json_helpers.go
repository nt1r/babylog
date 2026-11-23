package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// maxAPIBodyBytes 限制常规业务 JSON 请求体最大为 64 KiB，防止恶意超大载荷。
const maxAPIBodyBytes = 64 * 1024

// readJSONBytes 统一校验 JSON Content-Type 与载荷上限（精确区分 415/413/400），
// 供登录接口（16 KiB）与常规业务写入接口（64 KiB）共用同一道安全守卫。
func readJSONBytes(c *gin.Context, maxBytes int64, wrongCTMsg string) ([]byte, int, string) {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, http.StatusUnsupportedMediaType, wrongCTMsg
	}

	if c.Request.ContentLength > maxBytes {
		return nil, http.StatusRequestEntityTooLarge, "请求内容过大"
	}

	limited := http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
	body, err := io.ReadAll(limited)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return nil, http.StatusRequestEntityTooLarge, "请求内容过大"
		}
		return nil, http.StatusBadRequest, "请求内容读取失败"
	}

	return body, 0, ""
}

// decodeJSONBody 严格校验 JSON Content-Type、载荷大小与语法结构，精确区分 415/413/400。
func decodeJSONBody(c *gin.Context, dst any) (int, string) {
	body, status, msg := readJSONBytes(c, maxAPIBodyBytes, "请使用 JSON 格式提交数据")
	if status != 0 {
		return status, msg
	}

	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return http.StatusBadRequest, "请求数据格式不正确"
	}
	// 拒绝 JSON 对象后附带的多余非空白内容。
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		return http.StatusBadRequest, "请求数据格式不正确"
	}
	return 0, ""
}

// parseTimezoneQuery 从查询参数解析 IANA 时区（缺失时默认 Asia/Shanghai），非法时直接写回 400。
func parseTimezoneQuery(c *gin.Context) (*time.Location, bool) {
	loc, err := timeutil.LoadLocation(c.Query("tz"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return nil, false
	}
	return loc, true
}

// parseIDParam 解析路径参数 :id 为正整数。
func parseIDParam(c *gin.Context) (int64, bool) {
	raw := strings.TrimSpace(c.Param("id"))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的记录编号"})
		return 0, false
	}
	return id, true
}

// parseListFilter 解析记录列表查询的筛选、时区与分页参数。
func parseListFilter(c *gin.Context) (records.ListFilter, bool) {
	loc, ok := parseTimezoneQuery(c)
	if !ok {
		return records.ListFilter{}, false
	}

	limit := records.DefaultListLimit
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 || parsed > records.MaxListLimit {
			c.JSON(http.StatusBadRequest, gin.H{"error": "分页大小应在 1 至 100 之间"})
			return records.ListFilter{}, false
		}
		limit = parsed
	}

	offset := 0
	if rawOffset := strings.TrimSpace(c.Query("offset")); rawOffset != "" {
		parsed, err := strconv.Atoi(rawOffset)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "分页偏移量不能为负数"})
			return records.ListFilter{}, false
		}
		offset = parsed
	}

	return records.ListFilter{
		Subtype: strings.TrimSpace(c.Query("subtype")),
		Range:   strings.TrimSpace(c.Query("range")),
		Loc:     loc,
		Limit:   limit,
		Offset:  offset,
	}, true
}
