// Package records 管理喂养、睡眠、日常护理与健康生长四类结构化记录的校验、CRUD、按日小计与智能默认值。
package records

import (
	"errors"
	"time"
)

const (
	// 文本长度、批量上限与列表分页边界（MaxListLimit 与前端列表/生长曲线查询上限对齐）。
	MaxNoteLength       = 500
	MaxBatchCreateItems = 20
	DefaultListLimit    = 20
	MaxListLimit        = 100

	// 喂养、睡眠与健康体格字段的业务合法区间边界。
	MinMilkML       = 1
	MaxMilkML       = 1000
	MinBreastMin    = 1
	MaxBreastMin    = 180
	MinSleepMin     = 1
	MaxSleepMin     = 24 * 60
	MinTemperatureC = 34.0
	MaxTemperatureC = 43.0
	MinWeightKg     = 0.3
	MaxWeightKg     = 40.0
	MinHeightCm     = 20.0
	MaxHeightCm     = 150.0
	MinHeadCm       = 20.0
	MaxHeadCm       = 70.0

	// 无历史记录时智能默认值使用的冷启动初始数值。
	DefaultStarterMilk      = 90
	DefaultStarterBreastMin = 15
	DefaultStarterNapMin    = 60
	DefaultStarterNightMin  = 480
	DefaultStarterTemp      = 36.6

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

	// 喂养方式、亲喂侧别、辅食接受度与排泄观察的标准枚举常量，供校验、汇总、看板与导出共用。
	FeedingModeDirect = "direct"
	FeedingModeBottle = "bottle"

	BreastSideLeft  = "left"
	BreastSideRight = "right"
	BreastSideBoth  = "both"

	AcceptanceLike    = "like"
	AcceptanceNeutral = "neutral"
	AcceptanceDislike = "dislike"

	DiaperKindPee  = "pee"
	DiaperKindPoop = "poop"
	DiaperKindBoth = "both"

	StoolConsistencyWatery = "watery"
	StoolConsistencySoft   = "soft"
	StoolConsistencyFormed = "formed"
	StoolConsistencyHard   = "hard"

	StoolColorYellow   = "yellow"
	StoolColorGreen    = "green"
	StoolColorBrown    = "brown"
	StoolColorAbnormal = "abnormal"
)

// ValidationError 表示记录字段不符合业务校验规则，映射为 HTTP 400。
type ValidationError struct {
	Message string
}

// Error 实现内置 error 接口，返回可直接展示给前端的中文校验提示。
func (e *ValidationError) Error() string { return e.Message }

// ErrNotFound 表示目标记录不存在，映射为 HTTP 404。
var ErrNotFound = errors.New("记录不存在或已被删除")

// FeedingRecord 对应 SQLite 中的 feeding_records 表。
// 各子类型专属字段均使用指针类型（*string / *int），以区分“该子类型不适用（SQL NULL / JSON null）”与 Go 零值；
// 其余记录模型（[CareRecord]、[HealthRecord]）遵循同一约定，后续不再重复说明。
type FeedingRecord struct {
	ID          int64   `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID      int64   `gorm:"column:baby_id;not null" json:"-"`
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
	CreatedAt   string  `gorm:"column:created_at;not null" json:"-"`
	UpdatedAt   string  `gorm:"column:updated_at;not null" json:"-"`
}

// TableName 指定 GORM 映射的底层 SQLite 表名为 feeding_records。
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

// FeedingDailySummary 表示某一本地自然日的喂养小计；
// 配方奶与瓶喂母乳分项仅用于后端多日趋势与数据导出复用单一累加器，不冗余序列化到列表与今日汇总载荷。
type FeedingDailySummary struct {
	TotalML           int `json:"total_ml"`
	FormulaML         int `json:"-"`
	FormulaCount      int `json:"-"`
	BottleBreastML    int `json:"-"`
	BottleBreastCount int `json:"-"`
	DirectBreastCount int `json:"direct_breast_count"`
	DirectBreastMin   int `json:"direct_breast_min"`
	SolidCount        int `json:"solid_count"`
	TotalCount        int `json:"total_count"`
}

// SleepRecord 对应 SQLite 中的 sleep_records 表。
type SleepRecord struct {
	ID          int64  `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID      int64  `gorm:"column:baby_id;not null" json:"-"`
	Subtype     string `gorm:"column:subtype;not null" json:"subtype"`
	StartedAt   string `gorm:"column:started_at;not null" json:"started_at"`
	EndedAt     string `gorm:"column:ended_at;not null" json:"ended_at"`
	DurationMin int    `gorm:"column:duration_min;not null" json:"duration_min"`
	Note        string `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt   string `gorm:"column:created_at;not null" json:"-"`
	UpdatedAt   string `gorm:"column:updated_at;not null" json:"-"`
}

// TableName 指定 GORM 映射的底层 SQLite 表名为 sleep_records。
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
	BabyID           int64   `gorm:"column:baby_id;not null" json:"-"`
	Subtype          string  `gorm:"column:subtype;not null" json:"subtype"`
	DiaperKind       *string `gorm:"column:diaper_kind" json:"diaper_kind"`
	StoolConsistency *string `gorm:"column:stool_consistency" json:"stool_consistency"`
	StoolColor       *string `gorm:"column:stool_color" json:"stool_color"`
	CareTitle        *string `gorm:"column:care_title" json:"care_title"`
	RecordedAt       string  `gorm:"column:recorded_at;not null" json:"recorded_at"`
	Note             string  `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt        string  `gorm:"column:created_at;not null" json:"-"`
	UpdatedAt        string  `gorm:"column:updated_at;not null" json:"-"`
}

// TableName 指定 GORM 映射的底层 SQLite 表名为 care_records。
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

// HealthRecord 对应 SQLite 中的 health_records 表，
// 同时承载健康观察（temperature / medicine）与生长发育（growth / teeth）两类工作区数据。
type HealthRecord struct {
	ID             int64    `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID         int64    `gorm:"column:baby_id;not null" json:"-"`
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
	CreatedAt      string   `gorm:"column:created_at;not null" json:"-"`
	UpdatedAt      string   `gorm:"column:updated_at;not null" json:"-"`
}

// TableName 指定 GORM 映射的底层 SQLite 表名为 health_records。
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
	LatestTempC   *float64 `json:"latest_temp_c"`
}

// BatchCreateInput 表示单次事务内批量创建喂养与护理记录的输入载荷。
type BatchCreateInput struct {
	Feedings []FeedingInput `json:"feedings"`
	Cares    []CareInput    `json:"cares"`
}

// BatchCreateResult 表示批量创建成功后的返回结构，无数据的分类始终序列化为空数组 []。
type BatchCreateResult struct {
	Feedings []FeedingRecord `json:"feedings"`
	Cares    []CareRecord    `json:"cares"`
}

// ListFilter 表示记录列表查询的筛选与分页参数。
type ListFilter struct {
	Subtype string
	Range   string // 日期范围枚举：today / 7d / 30d / all
	Loc     *time.Location
	Limit   int
	Offset  int
}

// ListResult 是 Go 泛型响应结构（类型参数 T 为记录模型，S 为每日小计结构），
// 统一封装四类记录的分页列表与当前页涉及本地日期的完整每日小计，避免为每类记录重复定义分页信封。
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

// SolidFoodPreset 表示智能默认值中的常用辅食名称与最近份量。
type SolidFoodPreset struct {
	Food   string `json:"food"`
	Amount string `json:"amount"`
}

// FeedingDefaults 表示喂养快捷录入的智能默认值。
type FeedingDefaults struct {
	LastMilkML            int               `json:"last_milk_ml"`
	FrequentMilkML        []int             `json:"frequent_milk_ml"`
	LastFeedingSubtype    string            `json:"last_feeding_subtype"`
	LastMilkSubtype       string            `json:"last_milk_subtype"`
	LastBreastMode        string            `json:"last_breast_mode"`
	LastBreastDurationMin int               `json:"last_breast_duration_min"`
	LastBreastSide        *string           `json:"last_breast_side"`
	SuggestedBreastSide   string            `json:"suggested_breast_side"`
	RecentSolids          []SolidFoodPreset `json:"recent_solids"`
}

// SleepDefaults 表示睡眠快捷录入的习惯时长默认值。
type SleepDefaults struct {
	SuggestedNapMin   int `json:"suggested_nap_min"`
	SuggestedNightMin int `json:"suggested_night_min"`
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
	Sleep   SleepDefaults   `json:"sleep"`
	Health  HealthDefaults  `json:"health"`
	Care    CareDefaults    `json:"care"`
}

// WindowCategory 标识时间窗口快照读取与按日汇总涵盖的逻辑业务分类，
// 临床健康（health）与生长发育（growth）在接口层显式分离，底层继续共享 health_records 表。
type WindowCategory string

const (
	// WindowCategoryFeeding 表示喂养分类。
	WindowCategoryFeeding WindowCategory = "feeding"
	// WindowCategorySleep 表示睡眠分类。
	WindowCategorySleep WindowCategory = "sleep"
	// WindowCategoryCare 表示护理分类。
	WindowCategoryCare WindowCategory = "care"
	// WindowCategoryHealth 表示临床健康观察分类（体温与用药）。
	WindowCategoryHealth WindowCategory = "health"
	// WindowCategoryGrowth 表示生长发育分类（体格测量与长牙）。
	WindowCategoryGrowth WindowCategory = "growth"
)

// WindowQuery 描述时间窗口快照查询的 [Start, End) 区间与可选分类集合；
// Categories 为空时默认读取全部 5 类记录。
type WindowQuery struct {
	Start      time.Time
	End        time.Time
	Categories []WindowCategory
}

// WindowSnapshot 封装时间窗口 [Start, End) 内按时间升序（同时间戳按 ID 升序）排列的各分类日常记录；
// 其中喂养/护理/健康/生长按 recorded_at 落入窗口筛选，睡眠按与窗口存在交集筛选，
// 且临床健康（temperature / medicine）与生长发育（growth / teeth）已在读取时分离到 Healths 与 Growths。
type WindowSnapshot struct {
	Feedings []FeedingRecord
	Sleeps   []SleepRecord
	Cares    []CareRecord
	Healths  []HealthRecord
	Growths  []HealthRecord
}

// MedicineSummary 汇总时间窗口内的用药次数，以及按 RecordedAt 与 ID 确定性解析的最近一次用药信息。
type MedicineSummary struct {
	Count      int
	LatestName *string
	LatestAt   *string
}

// ClinicalHealthDayStats 汇总某一本地自然日内的最高体温与用药次数，供多日趋势与 Excel 导出共用。
type ClinicalHealthDayStats struct {
	MaxTempC      *float64
	MedicineCount int
}

// GrowthDailySummary 汇总某一本地自然日内的体格测量最新非空值（同日多条部分测量按字段覆盖保留最新）与出牙说明列表。
type GrowthDailySummary struct {
	WeightKg *float64
	HeightCm *float64
	HeadCm   *float64
	Teeth    []string
}

// DailyWindowSummary 聚合某一本地自然日内全部五类照护记录的统一按日小计。
type DailyWindowSummary struct {
	Feeding FeedingDailySummary
	Sleep   SleepDailySummary
	Care    CareDailySummary
	Health  ClinicalHealthDayStats
	Growth  GrowthDailySummary
}

// GrowthHighlights 汇总跨时间窗口独立解析的最新体格测量值与累计出牙记录数，
// 附带 JSON 标签供看板概览结构直接匿名嵌入，避免跨包逐字段拷贝。
type GrowthHighlights struct {
	LatestWeightKg   *float64 `json:"latest_weight_kg"`
	WeightRecordedAt *string  `json:"weight_recorded_at"`
	LatestHeightCm   *float64 `json:"latest_height_cm"`
	HeightRecordedAt *string  `json:"height_recorded_at"`
	LatestHeadCm     *float64 `json:"latest_head_cm"`
	HeadRecordedAt   *string  `json:"head_recorded_at"`
	TeethCount       int      `json:"teeth_count"`
	LatestToothNote  *string  `json:"latest_tooth_note"`
	LatestToothAt    *string  `json:"latest_tooth_at"`
}

// LatestHighlights 汇总跨时间窗口的最近照护标记（上次喂养、上次换尿布、最近一次体温及生长发育最新值）。
type LatestHighlights struct {
	LastFeedingAt *string
	LastDiaperAt  *string
	LatestTempC   *float64
	LatestTempAt  *string
	Growth        GrowthHighlights
}
