// Package baby 管理单宝宝档案的领域模型、输入校验与 SQLite 持久化。
package baby

import (
	"errors"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

const (
	MaxNicknameLength = 32
	MinBirthWeightKg  = 0.3
	MaxBirthWeightKg  = 15.0
	MinBirthHeightCm  = 20.0
	MaxBirthHeightCm  = 100.0
)

// ValidationError 表示用户输入不符合业务规则，映射为 HTTP 400。
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// ErrAlreadyExists 表示已存在宝宝档案，第 1 期单宝宝模式拒绝重复创建（映射 HTTP 409）。
var ErrAlreadyExists = errors.New("已存在宝宝档案，请直接修改现有信息")

// ErrNotFound 表示尚未创建宝宝档案（映射 HTTP 404 或记录接口前置 409）。
var ErrNotFound = errors.New("请先完成宝宝建档")

// Profile 对应 SQLite 中的 baby_profiles 表。
// 可选测量字段使用指针类型 *float64 而非 float64：Go 中普通 float64 零值为 0.0 无法表示“未填写”，
// 使用指针才能准确区分 nil（数据库 NULL / JSON null）与有效数值。
type Profile struct {
	ID            int64    `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	Nickname      string   `gorm:"column:nickname;not null" json:"nickname"`
	BirthDate     string   `gorm:"column:birth_date;not null" json:"birth_date"`
	Gender        string   `gorm:"column:gender;not null" json:"gender"`
	BirthWeightKg *float64 `gorm:"column:birth_weight_kg" json:"birth_weight_kg"`
	BirthHeightCm *float64 `gorm:"column:birth_height_cm" json:"birth_height_cm"`
	CreatedAt     string   `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt     string   `gorm:"column:updated_at;not null" json:"updated_at"`
}

// TableName 显式绑定 GORM 模型到 baby_profiles 表。
func (Profile) TableName() string {
	return "baby_profiles"
}

// UpsertInput 表示创建或更新宝宝档案的输入载荷。
type UpsertInput struct {
	Nickname      string   `json:"nickname"`
	BirthDate     string   `json:"birth_date"`
	Gender        string   `json:"gender"`
	BirthWeightKg *float64 `json:"birth_weight_kg"`
	BirthHeightCm *float64 `json:"birth_height_cm"`
}

// ValidateAndNormalize 校验并标准化宝宝档案输入，返回可直接入库的归一化副本。
// 出生日期按 loc 对应的本地自然日判断不得晚于今天；可选体重保留 2 位小数、身高保留 1 位小数。
// 校验失败时返回 [*ValidationError]。
func ValidateAndNormalize(in UpsertInput, now time.Time, loc *time.Location) (UpsertInput, error) {
	if loc == nil {
		loc, _ = timeutil.LoadLocation("")
	}

	nickname := strings.TrimSpace(in.Nickname)
	nicknameLen := utf8.RuneCountInString(nickname)
	if nicknameLen == 0 {
		return UpsertInput{}, &ValidationError{Message: "请填写宝宝昵称"}
	}
	if nicknameLen > MaxNicknameLength {
		return UpsertInput{}, &ValidationError{Message: "宝宝昵称最多 32 个字"}
	}

	birthDate := strings.TrimSpace(in.BirthDate)
	parsedDate, err := time.Parse(timeutil.DateLayout, birthDate)
	if err != nil {
		return UpsertInput{}, &ValidationError{Message: "出生日期格式应为 YYYY-MM-DD"}
	}
	// YYYY-MM-DD 格式的字典序与自然日先后严格一致，可直接按字符串比较是否为未来日期。
	todayStr := timeutil.LocalDateKey(now, loc)
	if birthDate > todayStr {
		return UpsertInput{}, &ValidationError{Message: "出生日期不能晚于今天"}
	}
	// 防止明显不合理的过早年份（例如早于 1900 年）。
	if parsedDate.Year() < 1900 {
		return UpsertInput{}, &ValidationError{Message: "出生日期不合理，请重新选择"}
	}

	gender := strings.TrimSpace(in.Gender)
	switch gender {
	case "male", "female", "unknown":
	default:
		return UpsertInput{}, &ValidationError{Message: "请选择有效的宝宝性别"}
	}

	// 可选浮点数须先拦截 NaN / Inf（防止非法浮点绕过区间比较），再按业务精度四舍五入。
	var weight *float64
	if in.BirthWeightKg != nil {
		v := *in.BirthWeightKg
		if math.IsNaN(v) || math.IsInf(v, 0) || v < MinBirthWeightKg || v > MaxBirthWeightKg {
			return UpsertInput{}, &ValidationError{Message: "出生体重应在 0.3 至 15.0 kg 之间"}
		}
		rounded := math.Round(v*100) / 100
		weight = &rounded
	}

	var height *float64
	if in.BirthHeightCm != nil {
		v := *in.BirthHeightCm
		if math.IsNaN(v) || math.IsInf(v, 0) || v < MinBirthHeightCm || v > MaxBirthHeightCm {
			return UpsertInput{}, &ValidationError{Message: "出生身高应在 20.0 至 100.0 cm 之间"}
		}
		rounded := math.Round(v*10) / 10
		height = &rounded
	}

	return UpsertInput{
		Nickname:      nickname,
		BirthDate:     birthDate,
		Gender:        gender,
		BirthWeightKg: weight,
		BirthHeightCm: height,
	}, nil
}
