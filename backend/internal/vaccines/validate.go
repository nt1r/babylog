package vaccines

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// timeHHMMPattern 在包初始化时经 regexp.MustCompile 预编译一次，避免每次校验重复编译正则。
var timeHHMMPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// normalizeDatePtr 校验可选日期指针并限定年份处于 [1900, 2200] 安全区间；
// 空串或纯空白统一收敛为 nil，以便落库为 SQL NULL。
func normalizeDatePtr(raw *string, fieldLabel string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := time.Parse(timeutil.DateLayout, trimmed)
	if err != nil || parsed.Year() < 1900 || parsed.Year() > 2200 {
		return nil, &ValidationError{Message: fmt.Sprintf("%s格式应为 YYYY-MM-DD", fieldLabel)}
	}
	return &trimmed, nil
}

func normalizeTimePtr(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, nil
	}
	if !timeHHMMPattern.MatchString(trimmed) {
		return nil, &ValidationError{Message: "预约时间格式应为 HH:MM（如 09:30）"}
	}
	return &trimmed, nil
}

func normalizeText(raw string, maxLen int, label string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	// Go 内置 len(s) 统计的是 UTF-8 字节数；中文字符计数须使用 utf8.RuneCountInString 按 Unicode 码点统计。
	if utf8.RuneCountInString(trimmed) > maxLen {
		return "", &ValidationError{Message: fmt.Sprintf("%s最多 %d 个字", label, maxLen)}
	}
	return trimmed, nil
}

// normalizeOptionalTextPtr 用于 [BatchUpdateInput] 的 *string 三态字段标准化：
// 与 normalizeDatePtr（空串转为 nil）刻意不同——当 raw 非 nil 且裁剪后为空串时，
// 必须返回指向 "" 的非 nil 指针，供上层区分“未传字段（nil，保留原值）”与“显式传空串（清空旧值）”。
func normalizeOptionalTextPtr(raw *string, maxLen int, label string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	norm, err := normalizeText(*raw, maxLen, label)
	if err != nil {
		return nil, err
	}
	return &norm, nil
}

// validateVaccinatedAt 校验实际接种日期必填且落在 [birthDate, todayKey] 范围内
// （YYYY-MM-DD 格式字典序与自然日先后严格一致，可直接字符串比较）。
func validateVaccinatedAt(raw *string, birthDate, todayKey, missingMsg string) (*string, error) {
	vacDate, err := normalizeDatePtr(raw, "实际接种日期")
	if err != nil {
		return nil, err
	}
	if vacDate == nil {
		return nil, &ValidationError{Message: missingMsg}
	}
	if *vacDate > todayKey {
		return nil, &ValidationError{Message: "实际接种日期不能晚于今天"}
	}
	if birthDate != "" && *vacDate < birthDate {
		return nil, &ValidationError{Message: "实际接种日期不能早于宝宝出生日期"}
	}
	return vacDate, nil
}

// validateDosePlans 校验自定义或定制模板的剂次排期列表（1..10 剂，逐剂核验月龄与可选预计日期）。
func validateDosePlans(doses []DosePlanInput) ([]DosePlanInput, error) {
	if len(doses) == 0 {
		return nil, &ValidationError{Message: "请至少保留 1 剂接种排期"}
	}
	if len(doses) > MaxTotalDoses {
		return nil, &ValidationError{Message: fmt.Sprintf("单种疫苗最多支持 %d 剂", MaxTotalDoses)}
	}
	out := make([]DosePlanInput, 0, len(doses))
	for i, d := range doses {
		if d.AgeMonths < 0 || d.AgeMonths > MaxAgeMonths {
			return nil, &ValidationError{Message: fmt.Sprintf("第 %d 剂的适龄月龄应在 0 至 %d 个月之间", i+1, MaxAgeMonths)}
		}
		plannedDate, err := normalizeDatePtr(d.PlannedDate, fmt.Sprintf("第 %d 剂预计接种日期", i+1))
		if err != nil {
			return nil, err
		}
		out = append(out, DosePlanInput{
			AgeMonths:   d.AgeMonths,
			PlannedDate: plannedDate,
		})
	}
	return out, nil
}

// validateCreateInput 校验并标准化新增自定义疫苗（单剂或多剂序列）的输入。
func validateCreateInput(in CreateCustomInput) (CreateCustomInput, error) {
	name, err := normalizeText(in.VaccineName, MaxNameLength, "疫苗名称")
	if err != nil {
		return CreateCustomInput{}, err
	}
	if name == "" {
		return CreateCustomInput{}, &ValidationError{Message: "请填写疫苗名称"}
	}

	category := strings.TrimSpace(in.Category)
	if category != CategoryNIP && category != CategoryOptional {
		return CreateCustomInput{}, &ValidationError{Message: "请选择有效的疫苗类型（免费或自费）"}
	}

	doses, err := validateDosePlans(in.Doses)
	if err != nil {
		return CreateCustomInput{}, err
	}

	note, err := normalizeText(in.Note, MaxNoteLength, "备注")
	if err != nil {
		return CreateCustomInput{}, err
	}

	return CreateCustomInput{
		VaccineName: name,
		Category:    category,
		Note:        note,
		Doses:       doses,
	}, nil
}

// validateUpdateInput 按目标状态校验并标准化单剂疫苗更新输入。
// 同时清空跨状态转换后的废弃字段，确保落库状态一致干净。
func validateUpdateInput(in UpdateDoseInput, birthDate, todayKey string) (UpdateDoseInput, error) {
	status := strings.TrimSpace(in.Status)
	if status != StatusPending && status != StatusScheduled && status != StatusCompleted {
		return UpdateDoseInput{}, &ValidationError{Message: "请选择有效的接种状态"}
	}

	var ageMonths *int
	if in.AgeMonths != nil {
		v := *in.AgeMonths
		if v < 0 || v > MaxAgeMonths {
			return UpdateDoseInput{}, &ValidationError{Message: fmt.Sprintf("适龄月龄应在 0 至 %d 个月之间", MaxAgeMonths)}
		}
		ageMonths = &v
	}

	plannedDate, err := normalizeDatePtr(in.PlannedDate, "预计接种日期")
	if err != nil {
		return UpdateDoseInput{}, err
	}
	clinicName, err := normalizeText(in.ClinicName, baby.MaxClinicNameLength, "接种地点")
	if err != nil {
		return UpdateDoseInput{}, err
	}
	note, err := normalizeText(in.Note, MaxNoteLength, "备注")
	if err != nil {
		return UpdateDoseInput{}, err
	}

	out := UpdateDoseInput{
		Status:      status,
		AgeMonths:   ageMonths,
		PlannedDate: plannedDate,
		Note:        note,
	}

	switch status {
	case StatusPending:
		// 恢复待接种时仅保留预计日期与备注，清空预约与实际接种记录字段。
		return out, nil

	case StatusScheduled:
		schedDate, err := normalizeDatePtr(in.ScheduledDate, "预约日期")
		if err != nil {
			return UpdateDoseInput{}, err
		}
		if schedDate == nil {
			return UpdateDoseInput{}, &ValidationError{Message: "登记预约时请选择预约日期"}
		}
		schedTime, err := normalizeTimePtr(in.ScheduledTime)
		if err != nil {
			return UpdateDoseInput{}, err
		}
		out.ScheduledDate = schedDate
		out.ScheduledTime = schedTime
		out.ClinicName = clinicName
		// 门诊为空时静默取消置顶标记，避免前端误勾选导致清空宝宝既有常去门诊。
		out.SetDefaultClinic = in.SetDefaultClinic && clinicName != ""
		return out, nil

	case StatusCompleted:
		vacDate, err := validateVaccinatedAt(in.VaccinatedAt, birthDate, todayKey, "标记已接种时请选择实际接种日期")
		if err != nil {
			return UpdateDoseInput{}, err
		}
		site, err := normalizeText(in.Site, MaxSiteLength, "接种部位")
		if err != nil {
			return UpdateDoseInput{}, err
		}
		maker, err := normalizeText(in.Manufacturer, MaxMakerLength, "疫苗厂家")
		if err != nil {
			return UpdateDoseInput{}, err
		}
		batchNo, err := normalizeText(in.BatchNo, MaxBatchNoLength, "疫苗批号")
		if err != nil {
			return UpdateDoseInput{}, err
		}
		reaction, err := normalizeText(in.Reaction, MaxReactionLength, "接种后反应")
		if err != nil {
			return UpdateDoseInput{}, err
		}
		out.VaccinatedAt = vacDate
		out.ClinicName = clinicName
		out.SetDefaultClinic = in.SetDefaultClinic && clinicName != ""
		out.Site = site
		out.Manufacturer = maker
		out.BatchNo = batchNo
		out.Reaction = reaction
		return out, nil
	}

	return out, nil
}

// validateBatchInput 校验并标准化批量预约或批量补录接种请求。
func validateBatchInput(in BatchUpdateInput, birthDate, todayKey string) (BatchUpdateInput, error) {
	action := strings.TrimSpace(in.Action)
	if action != BatchActionSchedule && action != BatchActionComplete {
		return BatchUpdateInput{}, &ValidationError{Message: "批量操作类型仅支持预约或标记已接种"}
	}
	if len(in.DoseIDs) == 0 {
		return BatchUpdateInput{}, &ValidationError{Message: "请至少选择一剂疫苗"}
	}
	if len(in.DoseIDs) > MaxBatchDoseCount {
		return BatchUpdateInput{}, &ValidationError{Message: fmt.Sprintf("单次批量操作最多支持 %d 剂疫苗", MaxBatchDoseCount)}
	}

	// map[int64]struct{} 是 Go 中零额外内存占用的 Set 惯用法，用于对批量剂次 ID 去重并保持原顺序。
	seen := make(map[int64]struct{}, len(in.DoseIDs))
	uniqueIDs := make([]int64, 0, len(in.DoseIDs))
	for _, id := range in.DoseIDs {
		if id <= 0 {
			return BatchUpdateInput{}, &ValidationError{Message: "包含无效的疫苗记录编号"}
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		uniqueIDs = append(uniqueIDs, id)
	}

	clinicName, err := normalizeOptionalTextPtr(in.ClinicName, baby.MaxClinicNameLength, "接种地点")
	if err != nil {
		return BatchUpdateInput{}, err
	}
	note, err := normalizeOptionalTextPtr(in.Note, MaxNoteLength, "备注")
	if err != nil {
		return BatchUpdateInput{}, err
	}

	out := BatchUpdateInput{
		Action:           action,
		DoseIDs:          uniqueIDs,
		ClinicName:       clinicName,
		SetDefaultClinic: in.SetDefaultClinic && clinicName != nil && *clinicName != "",
		Note:             note,
	}

	if action == BatchActionSchedule {
		schedDate, err := normalizeDatePtr(in.ScheduledDate, "预约日期")
		if err != nil {
			return BatchUpdateInput{}, err
		}
		if schedDate == nil {
			return BatchUpdateInput{}, &ValidationError{Message: "批量预约请选择预约日期"}
		}
		schedTime, err := normalizeTimePtr(in.ScheduledTime)
		if err != nil {
			return BatchUpdateInput{}, err
		}
		out.ScheduledDate = schedDate
		out.ScheduledTime = schedTime
		return out, nil
	}

	vacDate, err := validateVaccinatedAt(in.VaccinatedAt, birthDate, todayKey, "批量确认已接种请选择实际接种日期")
	if err != nil {
		return BatchUpdateInput{}, err
	}
	out.VaccinatedAt = vacDate
	return out, nil
}
