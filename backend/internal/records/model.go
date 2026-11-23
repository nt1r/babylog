// Package records 管理喂养、睡眠、日常护理与健康生长四类结构化记录的校验、CRUD、按日小计与智能默认值。
package records

import (
	"errors"
	"time"
)

const (
	MaxNoteLength      = 500
	DefaultListLimit   = 20
	MaxListLimit       = 100
	MinMilkML          = 1
	MaxMilkML          = 1000
	MinBreastMin       = 1
	MaxBreastMin       = 180
	MinSleepMin        = 1
	MaxSleepMin        = 24 * 60
	MinTemperatureC    = 34.0
	MaxTemperatureC    = 43.0
	MinWeightKg        = 0.3
	MaxWeightKg        = 40.0
	MinHeightCm        = 20.0
	MaxHeightCm        = 150.0
	MinHeadCm          = 20.0
	MaxHeadCm          = 70.0
	DefaultStarterMilk = 90
	DefaultStarterTemp = 36.6

	// 四类记录的标准子类型常量，统一用于校验、列表筛选、汇总与智能默认值。
	FeedingSubtypeBreast  = "breast"
	FeedingSubtypeFormula = "formula"
	FeedingSubtypeSolid   = "solid"

	SleepSubtypeNap   = "nap"
	SleepSubtypeNight = "night"

	CareSubtypeDiaper = "diaper"
	CareSubtypeBath   = "bath"
	CareSubtypeOther  = "other"

	HealthSubtypeTemperature = "temperature"
	HealthSubtypeMedicine    = "medicine"
	HealthSubtypeGrowth      = "growth"
	HealthSubtypeTeeth       = "teeth"
)

// ValidationError 表示记录字段不符合业务校验规则，映射为 HTTP 400。
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// ErrNotFound 表示目标记录不存在，映射为 HTTP 404。
var ErrNotFound = errors.New("记录不存在或已被删除")

// FeedingRecord 对应 SQLite 中的 feeding_records 表。
type FeedingRecord struct {
	ID          int64   `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID      int64   `gorm:"column:baby_id;not null" json:"baby_id"`
	Subtype     string  `gorm:"column:subtype;not null" json:"subtype"`
	FeedingMode *string `gorm:"column:feeding_mode" json:"feeding_mode"`
	BreastSide  *string `gorm:"column:breast_side" json:"breast_side"`
	AmountML    *int    `gorm:"column:amount_ml" json:"amount_ml"`
	DurationMin *int    `gorm:"column:duration_min" json:"duration_min"`
	SolidFood   *string `gorm:"column:solid_food" json:"solid_food"`
	SolidAmount *string `gorm:"column:solid_amount" json:"solid_amount"`
	Acceptance  *string `gorm:"column:acceptance" json:"acceptance"`
	RecordedAt  string  `gorm:"column:recorded_at;not null" json:"recorded_at"`
	Note        string  `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt   string  `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt   string  `gorm:"column:updated_at;not null" json:"updated_at"`
}

func (FeedingRecord) TableName() string { return "feeding_records" }

// FeedingInput 表示创建或更新喂养记录的输入载荷。
type FeedingInput struct {
	Subtype     string  `json:"subtype"`
	FeedingMode *string `json:"feeding_mode"`
	BreastSide  *string `json:"breast_side"`
	AmountML    *int    `json:"amount_ml"`
	DurationMin *int    `json:"duration_min"`
	SolidFood   *string `json:"solid_food"`
	SolidAmount *string `json:"solid_amount"`
	Acceptance  *string `json:"acceptance"`
	RecordedAt  string  `json:"recorded_at"`
	Note        string  `json:"note"`
}

// FeedingDailySummary 表示某一本地自然日的喂养小计。
type FeedingDailySummary struct {
	TotalML           int `json:"total_ml"`
	DirectBreastCount int `json:"direct_breast_count"`
	DirectBreastMin   int `json:"direct_breast_min"`
	SolidCount        int `json:"solid_count"`
	TotalCount        int `json:"total_count"`
}

// SleepRecord 对应 SQLite 中的 sleep_records 表。
type SleepRecord struct {
	ID          int64  `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID      int64  `gorm:"column:baby_id;not null" json:"baby_id"`
	Subtype     string `gorm:"column:subtype;not null" json:"subtype"`
	StartedAt   string `gorm:"column:started_at;not null" json:"started_at"`
	EndedAt     string `gorm:"column:ended_at;not null" json:"ended_at"`
	DurationMin int    `gorm:"column:duration_min;not null" json:"duration_min"`
	Note        string `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt   string `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt   string `gorm:"column:updated_at;not null" json:"updated_at"`
}

func (SleepRecord) TableName() string { return "sleep_records" }

// SleepInput 表示创建或更新睡眠记录的输入载荷。
type SleepInput struct {
	Subtype   string `json:"subtype"`
	StartedAt string `json:"started_at"`
	EndedAt   string `json:"ended_at"`
	Note      string `json:"note"`
}

// SleepDailySummary 表示某一本地自然日的睡眠小计（跨夜按自然日边界切分）。
type SleepDailySummary struct {
	TotalMin int `json:"total_min"`
	NapCount int `json:"nap_count"`
	NightMin int `json:"night_min"`
}

// CareRecord 对应 SQLite 中的 care_records 表。
type CareRecord struct {
	ID               int64   `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID           int64   `gorm:"column:baby_id;not null" json:"baby_id"`
	Subtype          string  `gorm:"column:subtype;not null" json:"subtype"`
	DiaperKind       *string `gorm:"column:diaper_kind" json:"diaper_kind"`
	StoolConsistency *string `gorm:"column:stool_consistency" json:"stool_consistency"`
	StoolColor       *string `gorm:"column:stool_color" json:"stool_color"`
	CareTitle        *string `gorm:"column:care_title" json:"care_title"`
	RecordedAt       string  `gorm:"column:recorded_at;not null" json:"recorded_at"`
	Note             string  `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt        string  `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt        string  `gorm:"column:updated_at;not null" json:"updated_at"`
}

func (CareRecord) TableName() string { return "care_records" }

// CareInput 表示创建或更新护理记录的输入载荷。
type CareInput struct {
	Subtype          string  `json:"subtype"`
	DiaperKind       *string `json:"diaper_kind"`
	StoolConsistency *string `json:"stool_consistency"`
	StoolColor       *string `json:"stool_color"`
	CareTitle        *string `json:"care_title"`
	RecordedAt       string  `json:"recorded_at"`
	Note             string  `json:"note"`
}

// CareDailySummary 表示某一本地自然日的护理小计。
type CareDailySummary struct {
	TotalCount int `json:"total_count"`
	PeeCount   int `json:"pee_count"`
	PoopCount  int `json:"poop_count"`
	BathCount  int `json:"bath_count"`
	OtherCount int `json:"other_count"`
}

// HealthRecord 对应 SQLite 中的 health_records 表。
type HealthRecord struct {
	ID             int64    `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID         int64    `gorm:"column:baby_id;not null" json:"baby_id"`
	Subtype        string   `gorm:"column:subtype;not null" json:"subtype"`
	TemperatureC   *float64 `gorm:"column:temperature_c" json:"temperature_c"`
	MedicineName   *string  `gorm:"column:medicine_name" json:"medicine_name"`
	MedicineDosage *string  `gorm:"column:medicine_dosage" json:"medicine_dosage"`
	WeightKg       *float64 `gorm:"column:weight_kg" json:"weight_kg"`
	HeightCm       *float64 `gorm:"column:height_cm" json:"height_cm"`
	HeadCm         *float64 `gorm:"column:head_cm" json:"head_cm"`
	ToothNote      *string  `gorm:"column:tooth_note" json:"tooth_note"`
	RecordedAt     string   `gorm:"column:recorded_at;not null" json:"recorded_at"`
	Note           string   `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt      string   `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt      string   `gorm:"column:updated_at;not null" json:"updated_at"`
}

func (HealthRecord) TableName() string { return "health_records" }

// HealthInput 表示创建或更新健康与生长记录的输入载荷。
type HealthInput struct {
	Subtype        string   `json:"subtype"`
	TemperatureC   *float64 `json:"temperature_c"`
	MedicineName   *string  `json:"medicine_name"`
	MedicineDosage *string  `json:"medicine_dosage"`
	WeightKg       *float64 `json:"weight_kg"`
	HeightCm       *float64 `json:"height_cm"`
	HeadCm         *float64 `json:"head_cm"`
	ToothNote      *string  `json:"tooth_note"`
	RecordedAt     string   `json:"recorded_at"`
	Note           string   `json:"note"`
}

// HealthDailySummary 表示某一本地自然日的健康记录小计。
type HealthDailySummary struct {
	TotalCount    int      `json:"total_count"`
	MedicineCount int      `json:"medicine_count"`
	GrowthCount   int      `json:"growth_count"`
	TeethCount    int      `json:"teeth_count"`
	LatestTempC   *float64 `json:"latest_temp_c"`
}

// ListFilter 表示记录列表查询的筛选与分页参数。
type ListFilter struct {
	Subtype string
	Range   string // today | 7d | 30d | all
	Loc     *time.Location
	Limit   int
	Offset  int
}

// ListResult 统一封装记录分页列表与当前页涉及本地日期的完整每日小计。
type ListResult[T any, S any] struct {
	Items          []T          `json:"items"`
	Total          int64        `json:"total"`
	HasMore        bool         `json:"has_more"`
	DailySummaries map[string]S `json:"daily_summaries"`
}

// MedicinePreset 表示智能默认值中的常用药品与最近剂量。
type MedicinePreset struct {
	Name   string `json:"name"`
	Dosage string `json:"dosage"`
}

// FeedingDefaults 表示喂养快捷录入的智能默认值。
type FeedingDefaults struct {
	LastMilkML          int      `json:"last_milk_ml"`
	FrequentMilkML      []int    `json:"frequent_milk_ml"`
	LastFeedingSubtype  string   `json:"last_feeding_subtype"`
	LastBreastSide      *string  `json:"last_breast_side"`
	SuggestedBreastSide string   `json:"suggested_breast_side"`
	RecentSolidFoods    []string `json:"recent_solid_foods"`
}

// HealthDefaults 表示健康快捷录入的智能默认值。
type HealthDefaults struct {
	LastTemperatureC float64          `json:"last_temperature_c"`
	RecentMedicines  []MedicinePreset `json:"recent_medicines"`
}

// CareDefaults 表示护理快捷录入的智能默认值。
type CareDefaults struct {
	RecentOtherTitles []string `json:"recent_other_titles"`
}

// SmartDefaults 汇总返回给前端预填与 1-Tap 按钮的习惯默认值。
type SmartDefaults struct {
	Feeding FeedingDefaults `json:"feeding"`
	Health  HealthDefaults  `json:"health"`
	Care    CareDefaults    `json:"care"`
}

// WindowOptions 控制 ReadWindow 是否包含健康记录，避免看板今日汇总轮询多打一次无用查询。
type WindowOptions struct {
	IncludeHealth bool
}

// WindowSnapshot 封装时间窗口 [start, end) 内的日常记录，
// 其中喂养/护理/健康按 recorded_at 落入窗口筛选，睡眠按与窗口存在交集筛选。
type WindowSnapshot struct {
	Feedings []FeedingRecord
	Sleeps   []SleepRecord
	Cares    []CareRecord
	Healths  []HealthRecord
}

// LatestHighlights 汇总跨时间窗口的最近照护标记（上次喂养、上次换尿布、最近一次体温）。
type LatestHighlights struct {
	LastFeedingAt *string
	LastDiaperAt  *string
	LatestTempC   *float64
	LatestTempAt  *string
}
