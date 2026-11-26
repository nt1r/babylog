package vaccines

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// addCalendarMonthsClamped 按自然月累加月龄并对月底日期钳位（例如 2026-01-31 + 1 月 = 2026-02-28，
// 2024-01-31 + 1 月 = 2024-02-29），避免标准库 time.AddDate 溢出到下个月。
func addCalendarMonthsClamped(baseDateStr string, months int) (string, error) {
	base, err := time.Parse(timeutil.DateLayout, strings.TrimSpace(baseDateStr))
	if err != nil {
		return "", err
	}
	if months == 0 {
		return base.Format(timeutil.DateLayout), nil
	}

	totalMonths := base.Year()*12 + int(base.Month()-1) + months
	targetYear := totalMonths / 12
	targetMonth := time.Month(totalMonths%12 + 1)
	if totalMonths < 0 {
		// 防御性处理，正常业务 months >= 0
		targetYear = (totalMonths - 11) / 12
		targetMonth = time.Month((totalMonths%12+12)%12 + 1)
	}

	lastDayOfMonth := daysInMonth(targetYear, targetMonth)
	day := base.Day()
	if day > lastDayOfMonth {
		day = lastDayOfMonth
	}
	return time.Date(targetYear, targetMonth, day, 0, 0, 0, 0, time.UTC).Format(timeutil.DateLayout), nil
}

func daysInMonth(year int, month time.Month) int {
	// Go 的 time.Date 支持日期规范化：传入下月第 0 天会自动回退为当月最后一天（自动兼容闰年 2 月）。
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// calendarDayDiff 计算 target - today 的自然日天数差（两参数均为 YYYY-MM-DD）。
// 依赖 time.Parse 默认按 UTC 解析（无夏令时 23h/25h 偏移），确保按 24 小时整除无 1 天误差。
func calendarDayDiff(targetDateStr, todayDateStr string) int {
	target, err1 := time.Parse(timeutil.DateLayout, targetDateStr)
	today, err2 := time.Parse(timeutil.DateLayout, todayDateStr)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(target.Sub(today).Hours() / 24)
}

// deriveAlertState 根据持久化状态与距今自然日天数差推导 7 态提醒状态：
//   - completed：恒为 AlertCompleted
//   - scheduled：< 0 为 scheduled_overdue，[0, 7] 为 scheduled_soon，> 7 为 scheduled
//   - pending：< -14 为 overdue，[-14, 14] 为 due_soon，> 14 为 upcoming
func deriveAlertState(status string, daysUntil int) string {
	switch status {
	case StatusCompleted:
		return AlertCompleted
	case StatusScheduled:
		if daysUntil < 0 {
			return AlertScheduledOverdue
		}
		if daysUntil <= ScheduledSoonWindowDays {
			return AlertScheduledSoon
		}
		return AlertScheduled
	default:
		if daysUntil < -PendingDueSoonWindowDays {
			return AlertOverdue
		}
		if daysUntil <= PendingDueSoonWindowDays {
			return AlertDueSoon
		}
		return AlertUpcoming
	}
}

// formatAgeLabel 将月龄整数格式化为家长易读的中文阶段标签。
func formatAgeLabel(ageMonths int) string {
	if ageMonths <= 0 {
		return "出生时"
	}
	if ageMonths >= 24 && ageMonths%12 == 0 {
		return fmt.Sprintf("%d周岁", ageMonths/12)
	}
	return fmt.Sprintf("%d月龄", ageMonths)
}

// buildDoseView 组合数据库记录、内置知识库与实时派生字段：
// EffectiveDate 按三态优先级（vaccinated_at / scheduled_date / planned_date）取非空值，否则回退 defaultDue；
// Deletable 与模板匹配统一委托 lifecycle 内部规则，避免跨文件口径漂移。
func buildDoseView(rec DoseRecord, birthDate string, todayKey string) DoseView {
	defaultDue, err := addCalendarMonthsClamped(birthDate, rec.AgeMonths)
	if err != nil {
		defaultDue = birthDate
	}

	effectiveDate := defaultDue
	switch rec.Status {
	case StatusCompleted:
		if rec.VaccinatedAt != nil && *rec.VaccinatedAt != "" {
			effectiveDate = *rec.VaccinatedAt
		}
	case StatusScheduled:
		if rec.ScheduledDate != nil && *rec.ScheduledDate != "" {
			effectiveDate = *rec.ScheduledDate
		}
	default:
		if rec.PlannedDate != nil && *rec.PlannedDate != "" {
			effectiveDate = *rec.PlannedDate
		}
	}

	daysUntil := calendarDayDiff(effectiveDate, todayKey)
	alertState := deriveAlertState(rec.Status, daysUntil)

	// 通过 append([]string(nil), src...) 浅拷贝包级只读切片，防止调用方误改共享的全局注意事项列表。
	view := DoseView{
		DoseRecord:        rec,
		ShortName:         rec.VaccineName,
		DefaultDueDate:    defaultDue,
		EffectiveDate:     effectiveDate,
		AlertState:        alertState,
		DaysUntil:         daysUntil,
		Deletable:         !rec.isProtectedNIP(),
		PrecautionsBefore: append([]string(nil), commonPrecautionsBefore...),
		PrecautionsAfter:  append([]string(nil), commonPrecautionsAfter...),
		RiskWarning:       "自定义或非标准模板疫苗请务必对照产品说明书及当地接种门诊医生医嘱核对剂次、间隔与禁忌。",
	}

	if tpl, matchedDose, ok := matchTemplateDose(rec); ok {
		view.ShortName = tpl.ShortName
		view.Prevents = tpl.Prevents
		view.Route = tpl.Route
		view.PrecautionsBefore = append([]string(nil), tpl.PrecautionsBefore...)
		view.PrecautionsAfter = append([]string(nil), tpl.PrecautionsAfter...)
		view.RiskWarning = tpl.RiskWarning

		if matchedDose != nil {
			if matchedDose.Route != "" {
				view.Route = matchedDose.Route
			}
			view.DoseTip = matchedDose.DoseTip
			view.IsBirthHospital = matchedDose.IsBirthHospital
		}
	}

	return view
}

// buildSummary 基于完整剂次视图聚合进度条、提醒计数、产院两针快捷确认状态与下一步焦点。
func buildSummary(doses []DoseView) Summary {
	// 显式使用 make([]int64, 0, 2) 而非 nil 切片，确保空结果在 JSON 序列化时输出 `[]` 而非 `null`。
	sum := Summary{
		BirthPendingDoseIDs: make([]int64, 0, 2),
	}

	for _, d := range doses {
		if d.Category == CategoryNIP {
			sum.NIPTotal++
			if d.Status == StatusCompleted {
				sum.NIPCompleted++
			}
		} else {
			sum.OptionalTotal++
			if d.Status == StatusCompleted {
				sum.OptionalCompleted++
			}
		}

		if d.Status == StatusScheduled {
			sum.ScheduledCount++
		}

		switch d.AlertState {
		case AlertOverdue:
			sum.OverdueCount++
		case AlertDueSoon:
			sum.DueSoonCount++
		case AlertScheduledSoon:
			sum.ScheduledSoonCount++
		case AlertScheduledOverdue:
			sum.ScheduledOverdueCount++
		}

		if d.IsBirthHospital && d.Status == StatusPending {
			sum.BirthPendingDoseIDs = append(sum.BirthPendingDoseIDs, d.ID)
		}
	}

	sum.BirthConfirmPending = len(sum.BirthPendingDoseIDs) > 0
	sum.NextFocus = pickNextFocus(doses)
	return sum
}

// focusPriority 定义下一步行动卡的筛选优先级（数字越小优先级越高）：
// 已预约过期 > 即将预约(7天内) > 待补种 > 近期可接种(±14天) > 远期已预约 > 未来未到龄。
func focusPriority(alertState string) int {
	switch alertState {
	case AlertScheduledOverdue:
		return 1
	case AlertScheduledSoon:
		return 2
	case AlertOverdue:
		return 3
	case AlertDueSoon:
		return 4
	case AlertScheduled:
		return 5
	case AlertUpcoming:
		return 6
	default:
		return 99
	}
}

// pickNextFocus 从全部未完成剂次中按优先级与日期选出主焦点，并合并同提醒状态、同目标日期的同期剂次；
// 首条剂次缺少门诊或预约时间时，由后续同组剂次补齐以保证焦点卡信息完整。
func pickNextFocus(doses []DoseView) *NextFocus {
	candidates := make([]DoseView, 0, len(doses))
	for _, d := range doses {
		if d.Status != StatusCompleted {
			candidates = append(candidates, d)
		}
	}
	if len(candidates) == 0 {
		return nil
	}

	// 使用稳定排序，按提醒优先级 → 目标日期 → 适龄月龄 → 记录编号确定唯一主焦点。
	sort.SliceStable(candidates, func(i, j int) bool {
		pi, pj := focusPriority(candidates[i].AlertState), focusPriority(candidates[j].AlertState)
		if pi != pj {
			return pi < pj
		}
		if candidates[i].EffectiveDate != candidates[j].EffectiveDate {
			return candidates[i].EffectiveDate < candidates[j].EffectiveDate
		}
		if candidates[i].AgeMonths != candidates[j].AgeMonths {
			return candidates[i].AgeMonths < candidates[j].AgeMonths
		}
		return candidates[i].ID < candidates[j].ID
	})

	lead := candidates[0]
	focus := &NextFocus{
		Kind:          lead.AlertState,
		TargetDate:    lead.EffectiveDate,
		DaysUntil:     lead.DaysUntil,
		AgeLabel:      lead.AgeLabel,
		ClinicName:    lead.ClinicName,
		ScheduledTime: ptrStringValue(lead.ScheduledTime),
		DoseIDs:       []int64{lead.ID},
	}

	// 将同提醒状态且同目标日期的同期剂次合并展示在焦点卡中，减少信息碎片。
	for _, other := range candidates[1:] {
		if other.AlertState == lead.AlertState && other.EffectiveDate == lead.EffectiveDate {
			focus.DoseIDs = append(focus.DoseIDs, other.ID)
			if focus.ClinicName == "" && other.ClinicName != "" {
				focus.ClinicName = other.ClinicName
			}
			if focus.ScheduledTime == "" && other.ScheduledTime != nil && *other.ScheduledTime != "" {
				focus.ScheduledTime = *other.ScheduledTime
			}
		}
	}

	return focus
}

func ptrStringValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
