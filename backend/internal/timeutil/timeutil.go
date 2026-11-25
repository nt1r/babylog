// Package timeutil 提供 IANA 时区解析（内嵌 tzdata）、UTC RFC3339 规范化、本地自然日窗口
// 以及跨夜区间按自然日切分等时间工具。
package timeutil

import (
	"errors"
	"math"
	"strings"
	"time"
	// 空白导入（_）仅触发 time/tzdata 包的 init()：将标准库 IANA 时区数据库编译进二进制，
	// 确保精简容器（无系统 tzdata 文件）及零 CGO 环境下始终可加载任意时区。
	_ "time/tzdata"
)

// DefaultTimezone 为未显式传递时区参数时的默认 IANA 时区。
const DefaultTimezone = "Asia/Shanghai"

// DateLayout 为标准本地日期格式。
// Go 不使用 YYYY-MM-DD 占位符，而是固定以参考时刻 "2006-01-02 15:04:05" 的对应数字作为格式化模板。
const DateLayout = "2006-01-02"

// MaxFutureSkew 允许客户端时钟相对服务端最多超前 5 分钟，避免点「刚刚」误报未来时间。
const MaxFutureSkew = 5 * time.Minute

// ErrInvalidTimezone 表示传入了无法识别的 IANA 时区名称。
var ErrInvalidTimezone = errors.New("时区参数无效")

// LoadLocation 解析 IANA 时区名称；空字符串回落为 [DefaultTimezone]（Asia/Shanghai）。
func LoadLocation(tz string) (*time.Location, error) {
	trimmed := strings.TrimSpace(tz)
	if trimmed == "" {
		trimmed = DefaultTimezone
	}
	// 拒绝 "Local" 以免依赖宿主机不确定时区配置。
	if strings.EqualFold(trimmed, "local") {
		return nil, ErrInvalidTimezone
	}
	loc, err := time.LoadLocation(trimmed)
	if err != nil {
		return nil, ErrInvalidTimezone
	}
	return loc, nil
}

// FormatUTC 将时间标准化为精确到秒的 UTC RFC3339 字符串，保证 SQLite 中可按字典序准确排序和范围比较。
func FormatUTC(t time.Time) string {
	return t.UTC().Truncate(time.Second).Format(time.RFC3339)
}

// ParseTimestamp 解析 RFC3339（含带毫秒 RFC3339Nano）时间戳并转为 UTC。
func ParseTimestamp(raw string) (time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Time{}, errors.New("时间不能为空")
	}
	parsed, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		return time.Time{}, errors.New("时间格式无效，请使用标准 ISO 时间")
	}
	return parsed.UTC().Truncate(time.Second), nil
}

// IsBeyondFutureSkew 检查目标时间是否超过当前时间加上允许的时钟偏差。
func IsBeyondFutureSkew(t, now time.Time) bool {
	return t.UTC().After(now.UTC().Add(MaxFutureSkew))
}

// LocalDayBounds 返回给定时刻在指定时区下的自然日起止 [start, end)（以该时区表示）。
func LocalDayBounds(now time.Time, loc *time.Location) (time.Time, time.Time) {
	localNow := now.In(loc)
	start := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	end := start.AddDate(0, 0, 1)
	return start, end
}

// LocalDateKey 返回时间在指定时区下的 YYYY-MM-DD 本地自然日键。
func LocalDateKey(t time.Time, loc *time.Location) string {
	return t.In(loc).Format(DateLayout)
}

// RecentLocalDateKeys 返回以 now 所在本地自然日为终点的连续 days 天日期键（升序）。
func RecentLocalDateKeys(now time.Time, days int, loc *time.Location) []string {
	if days <= 0 {
		return nil
	}
	todayStart, _ := LocalDayBounds(now, loc)
	startDay := todayStart.AddDate(0, 0, -(days - 1))
	keys := make([]string, days)
	for i := range days {
		keys[i] = startDay.AddDate(0, 0, i).Format(DateLayout)
	}
	return keys
}

// SplitIntervalMinutesByLocalDay 将 [start, end) 时间区间按指定时区的自然日边界切分，
// 返回每个本地自然日（YYYY-MM-DD）落入的分钟数。
//
// 使用逐日推进到下一自然日零点的方式处理跨单夜或跨多日区间，并对每段时长四舍五入到最近分钟，
// 避免带秒时间戳跨零点时被两端整除截断而丢失分钟。
func SplitIntervalMinutesByLocalDay(start, end time.Time, loc *time.Location) map[string]int {
	result := make(map[string]int)
	if !end.After(start) {
		return result
	}

	cur := start.In(loc)
	finish := end.In(loc)
	for cur.Before(finish) {
		// time.Date 会自动处理月末/年末进位以及夏令时（DST）切换时的本地零点。
		nextMidnight := time.Date(cur.Year(), cur.Month(), cur.Day()+1, 0, 0, 0, 0, loc)
		segEnd := nextMidnight
		if finish.Before(segEnd) {
			segEnd = finish
		}
		mins := int(math.Round(segEnd.Sub(cur).Minutes()))
		if mins > 0 {
			result[cur.Format(DateLayout)] += mins
		}
		cur = segEnd
	}
	return result
}
