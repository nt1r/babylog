package records

import (
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func strPtr(s string) *string { return &s }

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

// ValidateFeeding 校验并标准化喂养记录，返回可直接入库的归一化输入与 UTC 时间。
func ValidateFeeding(in FeedingInput, now time.Time) (FeedingInput, time.Time, error) {
	recordedAt, err := validateTimestamp(in.RecordedAt, now)
	if err != nil {
		return FeedingInput{}, time.Time{}, err
	}
	note, err := validateNote(in.Note)
	if err != nil {
		return FeedingInput{}, time.Time{}, err
	}

	out := FeedingInput{
		Subtype:    strings.TrimSpace(in.Subtype),
		RecordedAt: timeutil.FormatUTC(recordedAt),
		Note:       note,
	}

	switch out.Subtype {
	case "breast":
		if in.FeedingMode == nil {
			return FeedingInput{}, time.Time{}, &ValidationError{Message: "请选择母乳方式（亲喂或瓶喂）"}
		}
		mode := strings.TrimSpace(*in.FeedingMode)
		switch mode {
		case "direct":
			if in.BreastSide == nil {
				return FeedingInput{}, time.Time{}, &ValidationError{Message: "请选择亲喂侧别"}
			}
			side := strings.TrimSpace(*in.BreastSide)
			if side != "left" && side != "right" && side != "both" {
				return FeedingInput{}, time.Time{}, &ValidationError{Message: "请选择有效的亲喂侧别"}
			}
			if in.DurationMin == nil || *in.DurationMin < MinBreastMin || *in.DurationMin > MaxBreastMin {
				return FeedingInput{}, time.Time{}, &ValidationError{Message: "亲喂时长应在 1 至 180 分钟之间"}
			}
			dur := *in.DurationMin
			out.FeedingMode = strPtr("direct")
			out.BreastSide = strPtr(side)
			out.DurationMin = &dur
		case "bottle":
			if in.AmountML == nil || *in.AmountML < MinMilkML || *in.AmountML > MaxMilkML {
				return FeedingInput{}, time.Time{}, &ValidationError{Message: "瓶喂母乳奶量应在 1 至 1000 ml 之间"}
			}
			ml := *in.AmountML
			out.FeedingMode = strPtr("bottle")
			out.AmountML = &ml
		default:
			return FeedingInput{}, time.Time{}, &ValidationError{Message: "请选择有效的母乳方式"}
		}

	case "formula":
		if in.AmountML == nil || *in.AmountML < MinMilkML || *in.AmountML > MaxMilkML {
			return FeedingInput{}, time.Time{}, &ValidationError{Message: "配方奶奶量应在 1 至 1000 ml 之间"}
		}
		ml := *in.AmountML
		out.AmountML = &ml

	case "solid":
		food, err := trimOptionalString(in.SolidFood, 80, "辅食名称")
		if err != nil {
			return FeedingInput{}, time.Time{}, err
		}
		if food == nil {
			return FeedingInput{}, time.Time{}, &ValidationError{Message: "请填写辅食名称"}
		}
		amount, err := trimOptionalString(in.SolidAmount, 40, "辅食份量")
		if err != nil {
			return FeedingInput{}, time.Time{}, err
		}
		var acceptance *string
		if in.Acceptance != nil && strings.TrimSpace(*in.Acceptance) != "" {
			acc := strings.TrimSpace(*in.Acceptance)
			if acc != "like" && acc != "neutral" && acc != "dislike" {
				return FeedingInput{}, time.Time{}, &ValidationError{Message: "请选择有效的辅食接受度"}
			}
			acceptance = &acc
		}
		out.SolidFood = food
		out.SolidAmount = amount
		out.Acceptance = acceptance

	default:
		return FeedingInput{}, time.Time{}, &ValidationError{Message: "请选择有效的喂养类型"}
	}

	return out, recordedAt, nil
}

// ValidateSleep 校验睡眠补录区间并由服务端统一计算 duration_min。
func ValidateSleep(in SleepInput, now time.Time) (SleepInput, int, error) {
	subtype := strings.TrimSpace(in.Subtype)
	if subtype != "nap" && subtype != "night" {
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
func ValidateCare(in CareInput, now time.Time) (CareInput, time.Time, error) {
	recordedAt, err := validateTimestamp(in.RecordedAt, now)
	if err != nil {
		return CareInput{}, time.Time{}, err
	}
	note, err := validateNote(in.Note)
	if err != nil {
		return CareInput{}, time.Time{}, err
	}

	out := CareInput{
		Subtype:    strings.TrimSpace(in.Subtype),
		RecordedAt: timeutil.FormatUTC(recordedAt),
		Note:       note,
	}

	switch out.Subtype {
	case "diaper":
		if in.DiaperKind == nil {
			return CareInput{}, time.Time{}, &ValidationError{Message: "请选择尿布类型（嘘嘘/便便/混合）"}
		}
		kind := strings.TrimSpace(*in.DiaperKind)
		if kind != "pee" && kind != "poop" && kind != "both" {
			return CareInput{}, time.Time{}, &ValidationError{Message: "请选择有效的尿布类型"}
		}
		out.DiaperKind = strPtr(kind)

		// 仅包含便便时保留可选性状与颜色；纯嘘嘘时自动置空。
		if kind == "poop" || kind == "both" {
			if in.StoolConsistency != nil && strings.TrimSpace(*in.StoolConsistency) != "" {
				c := strings.TrimSpace(*in.StoolConsistency)
				switch c {
				case "watery", "soft", "formed", "hard":
					out.StoolConsistency = &c
				default:
					return CareInput{}, time.Time{}, &ValidationError{Message: "请选择有效的便便性状"}
				}
			}
			if in.StoolColor != nil && strings.TrimSpace(*in.StoolColor) != "" {
				color := strings.TrimSpace(*in.StoolColor)
				switch color {
				case "yellow", "green", "brown", "abnormal":
					out.StoolColor = &color
				default:
					return CareInput{}, time.Time{}, &ValidationError{Message: "请选择有效的便便颜色"}
				}
			}
		}

	case "bath":
		// 洗澡无需额外必填字段。

	case "other":
		title, err := trimOptionalString(in.CareTitle, 60, "护理内容")
		if err != nil {
			return CareInput{}, time.Time{}, err
		}
		if title == nil {
			return CareInput{}, time.Time{}, &ValidationError{Message: "请填写或选择护理内容"}
		}
		out.CareTitle = title

	default:
		return CareInput{}, time.Time{}, &ValidationError{Message: "请选择有效的护理类型"}
	}

	return out, recordedAt, nil
}

// ValidateHealth 校验并标准化健康与生长记录。
func ValidateHealth(in HealthInput, now time.Time) (HealthInput, time.Time, error) {
	recordedAt, err := validateTimestamp(in.RecordedAt, now)
	if err != nil {
		return HealthInput{}, time.Time{}, err
	}
	note, err := validateNote(in.Note)
	if err != nil {
		return HealthInput{}, time.Time{}, err
	}

	out := HealthInput{
		Subtype:    strings.TrimSpace(in.Subtype),
		RecordedAt: timeutil.FormatUTC(recordedAt),
		Note:       note,
	}

	switch out.Subtype {
	case "temperature":
		if in.TemperatureC == nil {
			return HealthInput{}, time.Time{}, &ValidationError{Message: "请填写体温数值"}
		}
		v := *in.TemperatureC
		if math.IsNaN(v) || math.IsInf(v, 0) || v < MinTemperatureC || v > MaxTemperatureC {
			return HealthInput{}, time.Time{}, &ValidationError{Message: "体温应在 34.0 至 43.0 ℃ 之间"}
		}
		rounded := math.Round(v*10) / 10
		out.TemperatureC = &rounded

	case "medicine":
		name, err := trimOptionalString(in.MedicineName, 80, "药品名称")
		if err != nil {
			return HealthInput{}, time.Time{}, err
		}
		if name == nil {
			return HealthInput{}, time.Time{}, &ValidationError{Message: "请填写药品名称"}
		}
		dosage, err := trimOptionalString(in.MedicineDosage, 40, "剂量")
		if err != nil {
			return HealthInput{}, time.Time{}, err
		}
		out.MedicineName = name
		out.MedicineDosage = dosage

	case "growth":
		if in.WeightKg == nil && in.HeightCm == nil && in.HeadCm == nil {
			return HealthInput{}, time.Time{}, &ValidationError{Message: "体重、身高、头围请至少填写一项"}
		}
		if in.WeightKg != nil {
			v := *in.WeightKg
			if math.IsNaN(v) || math.IsInf(v, 0) || v < MinWeightKg || v > MaxWeightKg {
				return HealthInput{}, time.Time{}, &ValidationError{Message: "体重应在 0.3 至 40.0 kg 之间"}
			}
			rounded := math.Round(v*100) / 100
			out.WeightKg = &rounded
		}
		if in.HeightCm != nil {
			v := *in.HeightCm
			if math.IsNaN(v) || math.IsInf(v, 0) || v < MinHeightCm || v > MaxHeightCm {
				return HealthInput{}, time.Time{}, &ValidationError{Message: "身高应在 20.0 至 150.0 cm 之间"}
			}
			rounded := math.Round(v*10) / 10
			out.HeightCm = &rounded
		}
		if in.HeadCm != nil {
			v := *in.HeadCm
			if math.IsNaN(v) || math.IsInf(v, 0) || v < MinHeadCm || v > MaxHeadCm {
				return HealthInput{}, time.Time{}, &ValidationError{Message: "头围应在 20.0 至 70.0 cm 之间"}
			}
			rounded := math.Round(v*10) / 10
			out.HeadCm = &rounded
		}

	case "teeth":
		tooth, err := trimOptionalString(in.ToothNote, 80, "长牙记录")
		if err != nil {
			return HealthInput{}, time.Time{}, err
		}
		if tooth == nil {
			return HealthInput{}, time.Time{}, &ValidationError{Message: "请填写萌出牙位或长牙说明"}
		}
		out.ToothNote = tooth

	default:
		return HealthInput{}, time.Time{}, &ValidationError{Message: "请选择有效的健康记录类型"}
	}

	return out, recordedAt, nil
}
