// Package baby 管理按用户归属的多宝宝档案领域模型、输入校验与 SQLite 持久化。
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
	// 宝宝档案文本长度（按 Unicode 字符数计）、体格区间与单用户档案数上限边界。
	MaxNicknameLength   = 32
	MaxClinicNameLength = 80
	MinBirthWeightKg    = 0.3
	MaxBirthWeightKg    = 15.0
	MinBirthHeightCm    = 20.0
	MaxBirthHeightCm    = 100.0
	maxBabiesPerUser    = 10
)

// ValidationError 表示宝宝档案输入或数量上限不符合业务规则，映射为 HTTP 400。
type ValidationError struct {
	Message string
}

// Error 实现内置 error 接口，返回可直接展示给前端的中文校验提示。
func (e *ValidationError) Error() string { return e.Message }

// ErrNotFound 表示目标宝宝档案不存在或不属于当前登录用户（统一映射 HTTP 404 防枚举）。
var ErrNotFound = errors.New("宝宝档案不存在")

// Profile 对应 SQLite 中的 baby_profiles 表。
// UserID 仅用于服务端数据归属与越权隔离，不对外序列化；
// 可选测量字段使用指针类型 *float64 区分未填写（NULL）与有效数值。
type Profile struct {
	ID                int64    `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	UserID            int64    `gorm:"column:user_id;not null;index" json:"-"`
	Nickname          string   `gorm:"column:nickname;not null" json:"nickname"`
	BirthDate         string   `gorm:"column:birth_date;not null" json:"birth_date"`
	Gender            string   `gorm:"column:gender;not null" json:"gender"`
	BirthWeightKg     *float64 `gorm:"column:birth_weight_kg" json:"birth_weight_kg"`
	BirthHeightCm     *float64 `gorm:"column:birth_height_cm" json:"birth_height_cm"`
	DefaultClinicName string   `gorm:"column:default_clinic_name;not null;default:''" json:"default_clinic_name"`
	CreatedAt         string   `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt         string   `gorm:"column:updated_at;not null" json:"updated_at"`
}

// TableName 显式绑定 GORM 模型到 baby_profiles 表。
func (Profile) TableName() string {
	return "baby_profiles"
}

// UpsertInput 表示创建或更新宝宝档案的输入载荷。
// DefaultClinicName 采用 *string 表达三态更新：nil 保留既有值、"" 显式清空、非空更新为裁剪后的门诊名称。
type UpsertInput struct {
	Nickname          string   `json:"nickname"`
	BirthDate         string   `json:"birth_date"`
	Gender            string   `json:"gender"`
	BirthWeightKg     *float64 `json:"birth_weight_kg"`
	BirthHeightCm     *float64 `json:"birth_height_cm"`
	DefaultClinicName *string  `json:"default_clinic_name,omitempty"`
}

// ValidateClinicName 校验并标准化常去接种门诊名称（允许空串表示清空，最多 80 个字）。
func ValidateClinicName(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if utf8.RuneCountInString(trimmed) > MaxClinicNameLength {
		return "", &ValidationError{Message: "常去接种门诊最多 80 个字"}
	}
	return trimmed, nil
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
	todayStr := timeutil.LocalDateKey(now, loc)
	if birthDate > todayStr {
		return UpsertInput{}, &ValidationError{Message: "出生日期不能晚于今天"}
	}
	if parsedDate.Year() < 1900 {
		return UpsertInput{}, &ValidationError{Message: "出生日期不合理，请重新选择"}
	}

	gender := strings.TrimSpace(in.Gender)
	switch gender {
	case "male", "female", "unknown":
	default:
		return UpsertInput{}, &ValidationError{Message: "请选择有效的宝宝性别"}
	}

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

	var clinicName *string
	if in.DefaultClinicName != nil {
		normClinic, err := ValidateClinicName(*in.DefaultClinicName)
		if err != nil {
			return UpsertInput{}, err
		}
		clinicName = &normClinic
	}

	return UpsertInput{
		Nickname:          nickname,
		BirthDate:         birthDate,
		Gender:            gender,
		BirthWeightKg:     weight,
		BirthHeightCm:     height,
		DefaultClinicName: clinicName,
	}, nil
}
