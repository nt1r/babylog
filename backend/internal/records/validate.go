package records

import (
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// strPtr 返回字符串字面量或局部变量的指针（Go 不允许直接对字符串字面量取地址 `&"direct"`）。
func strPtr(s string) *string { return &s }

// trimOptionalString 清洗可选文本指针：nil 或纯空白统一归一化为 nil（落库为 SQL NULL），
// 非空时按 UTF-8 字符数（而非字节数）校验长度上限。
func trimOptionalString(p *string, maxRunes int, label string) (*string, error) {
	if p == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*p)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > maxRunes {
		return nil, &ValidationError{Message: label + "长度超出限制"}
	}
	return &trimmed, nil
}

func validateNote(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if utf8.RuneCountInString(trimmed) > MaxNoteLength {
		return "", &ValidationError{Message: "备注最多 500 个字"}
	}
	return trimmed, nil
}

// validateTimestamp 解析 RFC3339 时间戳并拒绝超过允许时钟偏差（[timeutil.MaxFutureSkew]）的未来时间。
func validateTimestamp(raw string, now time.Time) (time.Time, error) {
	parsed, err := timeutil.ParseTimestamp(raw)
	if err != nil {
		return time.Time{}, &ValidationError{Message: err.Error()}
	}
	if timeutil.IsBeyondFutureSkew(parsed, now) {
		return time.Time{}, &ValidationError{Message: "记录时间不能晚于当前时间"}
	}
	return parsed, nil
}

// ValidateFeeding 校验并标准化喂养记录，返回可直接入库的归一化输入。
//
// 关键设计：始终构造全新的 out 结构体，仅填充当前 Subtype 对应的有效字段，
// 其余子类型字段保持 nil；配合 [Store.UpdateFeeding] 的显式列更新，可在跨子类型切换时自动清空旧字段。
// 校验失败时返回 [*ValidationError]。
func ValidateFeeding(in FeedingInput, now time.Time) (FeedingInput, error) {
	recordedAt, err := validateTimestamp(in.RecordedAt, now)
	if err != nil {
		return FeedingInput{}, err
	}
	note, err := validateNote(in.Note)
	if err != nil {
		return FeedingInput{}, err
	}

	out := FeedingInput{
		Subtype:    strings.TrimSpace(in.Subtype),
		RecordedAt: timeutil.FormatUTC(recordedAt),
		Note:       note,
	}

	switch out.Subtype {
	case FeedingSubtypeBreast:
		if in.FeedingMode == nil {
			return FeedingInput{}, &ValidationError{Message: "请选择母乳方式（亲喂或瓶喂）"}
		}
		mode := strings.TrimSpace(*in.FeedingMode)
		switch mode {
		case FeedingModeDirect:
			if in.BreastSide == nil {
				return FeedingInput{}, &ValidationError{Message: "请选择亲喂侧别"}
			}
			side := strings.TrimSpace(*in.BreastSide)
			if side != BreastSideLeft && side != BreastSideRight && side != BreastSideBoth {
				return FeedingInput{}, &ValidationError{Message: "请选择有效的亲喂侧别"}
			}
			if in.DurationMin == nil || *in.DurationMin < MinBreastMin || *in.DurationMin > MaxBreastMin {
				return FeedingInput{}, &ValidationError{Message: "亲喂时长应在 1 至 180 分钟之间"}
			}
			dur := *in.DurationMin
			out.FeedingMode = strPtr(FeedingModeDirect)
			out.BreastSide = strPtr(side)
			out.DurationMin = &dur
		case FeedingModeBottle:
			if in.AmountML == nil || *in.AmountML < MinMilkML || *in.AmountML > MaxMilkML {
				return FeedingInput{}, &ValidationError{Message: "瓶喂母乳奶量应在 1 至 1000 ml 之间"}
			}
			ml := *in.AmountML
			out.FeedingMode = strPtr(FeedingModeBottle)
			out.AmountML = &ml
		default:
			return FeedingInput{}, &ValidationError{Message: "请选择有效的母乳方式"}
		}

	case FeedingSubtypeFormula:
		if in.AmountML == nil || *in.AmountML < MinMilkML || *in.AmountML > MaxMilkML {
			return FeedingInput{}, &ValidationError{Message: "配方奶奶量应在 1 至 1000 ml 之间"}
		}
		ml := *in.AmountML
		out.AmountML = &ml

	case FeedingSubtypeSolid:
		food, err := trimOptionalString(in.SolidFood, 80, "辅食名称")
		if err != nil {
			return FeedingInput{}, err
		}
		if food == nil {
			return FeedingInput{}, &ValidationError{Message: "请填写辅食名称"}
		}
		amount, err := trimOptionalString(in.SolidAmount, 40, "辅食份量")
		if err != nil {
			return FeedingInput{}, err
		}
		var acceptance *string
		if in.Acceptance != nil && strings.TrimSpace(*in.Acceptance) != "" {
			acc := strings.TrimSpace(*in.Acceptance)
			if acc != AcceptanceLike && acc != AcceptanceNeutral && acc != AcceptanceDislike {
				return FeedingInput{}, &ValidationError{Message: "请选择有效的辅食接受度"}
			}
			acceptance = &acc
		}
		out.SolidFood = food
		out.SolidAmount = amount
		out.Acceptance = acceptance

	default:
		return FeedingInput{}, &ValidationError{Message: "请选择有效的喂养类型"}
	}

	return out, nil
}

// ValidateSleep 校验睡眠补录区间并由服务端统一计算 duration_min（防止客户端传入与起止时间矛盾的时长）。
// 要求：醒来时间晚于入睡时间、均不超过未来时钟偏差，且总时长在 [MinSleepMin, MaxSleepMin]（1 分钟至 24 小时）之间。
func ValidateSleep(in SleepInput, now time.Time) (SleepInput, int, error) {
	subtype := strings.TrimSpace(in.Subtype)
	if subtype != SleepSubtypeNap && subtype != SleepSubtypeNight {
		return SleepInput{}, 0, &ValidationError{Message: "请选择有效的睡眠类型"}
	}
	startedAt, err := validateTimestamp(in.StartedAt, now)
	if err != nil {
		return SleepInput{}, 0, &ValidationError{Message: "入睡" + err.Error()}
	}
	endedAt, err := validateTimestamp(in.EndedAt, now)
	if err != nil {
		return SleepInput{}, 0, &ValidationError{Message: "醒来" + err.Error()}
	}
	if !endedAt.After(startedAt) {
		return SleepInput{}, 0, &ValidationError{Message: "醒来时间必须晚于入睡时间"}
	}
	durationMin := int(math.Round(endedAt.Sub(startedAt).Minutes()))
	if durationMin < MinSleepMin {
		return SleepInput{}, 0, &ValidationError{Message: "睡眠时长至少为 1 分钟"}
	}
	if durationMin > MaxSleepMin {
		return SleepInput{}, 0, &ValidationError{Message: "单次睡眠时长不能超过 24 小时"}
	}

	note, err := validateNote(in.Note)
	if err != nil {
		return SleepInput{}, 0, err
	}

	return SleepInput{
		Subtype:   subtype,
		StartedAt: timeutil.FormatUTC(startedAt),
		EndedAt:   timeutil.FormatUTC(endedAt),
		Note:      note,
	}, durationMin, nil
}

// ValidateCare 校验并标准化日常护理记录。
func ValidateCare(in CareInput, now time.Time) (CareInput, error) {
	recordedAt, err := validateTimestamp(in.RecordedAt, now)
	if err != nil {
		return CareInput{}, err
	}
	note, err := validateNote(in.Note)
	if err != nil {
		return CareInput{}, err
	}

	out := CareInput{
		Subtype:    strings.TrimSpace(in.Subtype),
		RecordedAt: timeutil.FormatUTC(recordedAt),
		Note:       note,
	}

	switch out.Subtype {
	case CareSubtypeDiaper:
		if in.DiaperKind == nil {
			return CareInput{}, &ValidationError{Message: "请选择尿布类型（嘘嘘/便便/混合）"}
		}
		kind := strings.TrimSpace(*in.DiaperKind)
		if kind != DiaperKindPee && kind != DiaperKindPoop && kind != DiaperKindBoth {
			return CareInput{}, &ValidationError{Message: "请选择有效的尿布类型"}
		}
		out.DiaperKind = strPtr(kind)

		// 仅包含便便时保留可选性状与颜色；纯嘘嘘时自动置空。
		if kind == DiaperKindPoop || kind == DiaperKindBoth {
			if in.StoolConsistency != nil && strings.TrimSpace(*in.StoolConsistency) != "" {
				c := strings.TrimSpace(*in.StoolConsistency)
				switch c {
				case StoolConsistencyWatery, StoolConsistencySoft, StoolConsistencyFormed, StoolConsistencyHard:
					out.StoolConsistency = &c
				default:
					return CareInput{}, &ValidationError{Message: "请选择有效的便便性状"}
				}
			}
			if in.StoolColor != nil && strings.TrimSpace(*in.StoolColor) != "" {
				color := strings.TrimSpace(*in.StoolColor)
				switch color {
				case StoolColorYellow, StoolColorGreen, StoolColorBrown, StoolColorAbnormal:
					out.StoolColor = &color
				default:
					return CareInput{}, &ValidationError{Message: "请选择有效的便便颜色"}
				}
			}
		}

	case CareSubtypeBath:
		// 洗澡无需额外必填字段。

	case CareSubtypeOther:
		title, err := trimOptionalString(in.CareTitle, 60, "护理内容")
		if err != nil {
			return CareInput{}, err
		}
		if title == nil {
			return CareInput{}, &ValidationError{Message: "请填写或选择护理内容"}
		}
		out.CareTitle = title

	default:
		return CareInput{}, &ValidationError{Message: "请选择有效的护理类型"}
	}

	return out, nil
}

// ValidateHealth 校验并标准化健康与生长记录；
// 所有数值字段先拦截 NaN/Inf 再按业务精度四舍五入（体温/身高/头围 1 位小数，体重 2 位小数），
// 生长子类型（growth）要求体重、身高、头围至少填写一项。
func ValidateHealth(in HealthInput, now time.Time) (HealthInput, error) {
	recordedAt, err := validateTimestamp(in.RecordedAt, now)
	if err != nil {
		return HealthInput{}, err
	}
	note, err := validateNote(in.Note)
	if err != nil {
		return HealthInput{}, err
	}

	out := HealthInput{
		Subtype:    strings.TrimSpace(in.Subtype),
		RecordedAt: timeutil.FormatUTC(recordedAt),
		Note:       note,
	}

	switch out.Subtype {
	case HealthSubtypeTemperature:
		if in.TemperatureC == nil {
			return HealthInput{}, &ValidationError{Message: "请填写体温数值"}
		}
		v := *in.TemperatureC
		if math.IsNaN(v) || math.IsInf(v, 0) || v < MinTemperatureC || v > MaxTemperatureC {
			return HealthInput{}, &ValidationError{Message: "体温应在 34.0 至 43.0 ℃ 之间"}
		}
		rounded := math.Round(v*10) / 10
		out.TemperatureC = &rounded

	case HealthSubtypeMedicine:
		name, err := trimOptionalString(in.MedicineName, 80, "药品名称")
		if err != nil {
			return HealthInput{}, err
		}
		if name == nil {
			return HealthInput{}, &ValidationError{Message: "请填写药品名称"}
		}
		dosage, err := trimOptionalString(in.MedicineDosage, 40, "剂量")
		if err != nil {
			return HealthInput{}, err
		}
		out.MedicineName = name
		out.MedicineDosage = dosage

	case HealthSubtypeGrowth:
		if in.WeightKg == nil && in.HeightCm == nil && in.HeadCm == nil {
			return HealthInput{}, &ValidationError{Message: "体重、身高、头围请至少填写一项"}
		}
		if in.WeightKg != nil {
			v := *in.WeightKg
			if math.IsNaN(v) || math.IsInf(v, 0) || v < MinWeightKg || v > MaxWeightKg {
				return HealthInput{}, &ValidationError{Message: "体重应在 0.3 至 40.0 kg 之间"}
			}
			rounded := math.Round(v*100) / 100
			out.WeightKg = &rounded
		}
		if in.HeightCm != nil {
			v := *in.HeightCm
			if math.IsNaN(v) || math.IsInf(v, 0) || v < MinHeightCm || v > MaxHeightCm {
				return HealthInput{}, &ValidationError{Message: "身高应在 20.0 至 150.0 cm 之间"}
			}
			rounded := math.Round(v*10) / 10
			out.HeightCm = &rounded
		}
		if in.HeadCm != nil {
			v := *in.HeadCm
			if math.IsNaN(v) || math.IsInf(v, 0) || v < MinHeadCm || v > MaxHeadCm {
				return HealthInput{}, &ValidationError{Message: "头围应在 20.0 至 70.0 cm 之间"}
			}
			rounded := math.Round(v*10) / 10
			out.HeadCm = &rounded
		}

	case HealthSubtypeTeeth:
		tooth, err := trimOptionalString(in.ToothNote, 80, "长牙记录")
		if err != nil {
			return HealthInput{}, err
		}
		if tooth == nil {
			return HealthInput{}, &ValidationError{Message: "请填写萌出牙位或长牙说明"}
		}
		out.ToothNote = tooth

	default:
		return HealthInput{}, &ValidationError{Message: "请选择有效的健康记录类型"}
	}

	return out, nil
}

// ValidateBatchCreate 校验并标准化批量写入的喂养与护理记录切片；
// 强制总条数位于 [1, MaxBatchCreateItems]，并使用同一次时钟快照复用 [ValidateFeeding] 与 [ValidateCare]，
// 任一条校验失败立即返回带条目序号的 [*ValidationError]，确保调用方在开启事务前即可快速拦截异常批次。
func ValidateBatchCreate(in BatchCreateInput, now time.Time) (BatchCreateInput, error) {
	total := len(in.Feedings) + len(in.Cares)
	if total == 0 {
		return BatchCreateInput{}, &ValidationError{Message: "请至少填写一项记录"}
	}
	if total > MaxBatchCreateItems {
		return BatchCreateInput{}, &ValidationError{Message: fmt.Sprintf("单次最多批量提交 %d 条记录", MaxBatchCreateItems)}
	}

	cleanFeedings := make([]FeedingInput, 0, len(in.Feedings))
	for i, item := range in.Feedings {
		clean, err := ValidateFeeding(item, now)
		if err != nil {
			return BatchCreateInput{}, &ValidationError{Message: fmt.Sprintf("第 %d 条喂养记录：%s", i+1, err.Error())}
		}
		cleanFeedings = append(cleanFeedings, clean)
	}

	cleanCares := make([]CareInput, 0, len(in.Cares))
	for i, item := range in.Cares {
		clean, err := ValidateCare(item, now)
		if err != nil {
			return BatchCreateInput{}, &ValidationError{Message: fmt.Sprintf("第 %d 条护理记录：%s", i+1, err.Error())}
		}
		cleanCares = append(cleanCares, clean)
	}

	return BatchCreateInput{
		Feedings: cleanFeedings,
		Cares:    cleanCares,
	}, nil
}
