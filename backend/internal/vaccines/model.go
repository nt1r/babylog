// Package vaccines 管理单宝宝的疫苗接种计划、国家免疫规划内置知识库、
// 预计日期推算、派生提醒状态、预约与接种记录持久化。
package vaccines

import "errors"

const (
	// CategoryNIP 表示国家免疫规划疫苗（免费）。
	CategoryNIP = "nip"
	// CategoryOptional 表示非免疫规划疫苗（自费/按需添加）。
	CategoryOptional = "optional"

	// 三态持久化模型：待接种 / 已预约 / 已接种。
	StatusPending   = "pending"
	StatusScheduled = "scheduled"
	StatusCompleted = "completed"

	// 基于本地自然日实时派生的提醒展示状态（不落库，避免跨天陈旧）。
	AlertCompleted        = "completed"
	AlertScheduled        = "scheduled"
	AlertScheduledSoon    = "scheduled_soon"
	AlertScheduledOverdue = "scheduled_overdue"
	AlertUpcoming         = "upcoming"
	AlertDueSoon          = "due_soon"
	AlertOverdue          = "overdue"

	// 提醒窗口常量（天）：距预计接种日 ±14 天内为近期可接种，超过 14 天为待补种/待补录；
	// 已预约剂次距预约日 0~7 天内为即将接种。
	PendingDueSoonWindowDays = 14
	ScheduledSoonWindowDays  = 7

	// 批量操作单次最多允许的剂次数与字段长度上限。
	MaxBatchDoseCount   = 30
	MaxNameLength       = 60
	MaxClinicLength     = 80
	MaxSiteLength       = 32
	MaxMakerLength      = 60
	MaxBatchNoLength    = 60
	MaxReactionLength   = 200
	MaxNoteLength       = 500
	MaxAgeMonths        = 144
	MaxTotalDoses       = 10
	RecentClinicsLimit  = 3
	BatchActionSchedule = "schedule"
	BatchActionComplete = "complete"
)

// ValidationError 表示疫苗输入不符合业务校验规则，映射为 HTTP 400。
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// ErrNotFound 表示目标疫苗剂次或模板不存在，映射为 HTTP 404。
var ErrNotFound = errors.New("疫苗记录不存在或已被删除")

// ErrTemplateAlreadyAdded 表示该自费疫苗模板已在当前宝宝计划中，映射为 HTTP 409。
var ErrTemplateAlreadyAdded = errors.New("该疫苗模板已在宝宝接种计划中，无需重复添加")

// ErrCannotDeleteNIP 表示内置国家免疫规划基础剂次不允许删除，映射为 HTTP 400。
var ErrCannotDeleteNIP = errors.New("国家免疫规划基础疫苗不支持删除，如需调整请修改预计日期或备注")

// DoseRecord 对应 SQLite 中的 vaccine_doses 表。
type DoseRecord struct {
	ID            int64   `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	BabyID        int64   `gorm:"column:baby_id;not null" json:"baby_id"`
	TemplateCode  *string `gorm:"column:template_code" json:"template_code"`
	DoseNumber    int     `gorm:"column:dose_number;not null" json:"dose_number"`
	TotalDoses    int     `gorm:"column:total_doses;not null" json:"total_doses"`
	VaccineName   string  `gorm:"column:vaccine_name;not null" json:"vaccine_name"`
	Category      string  `gorm:"column:category;not null" json:"category"`
	AgeMonths     int     `gorm:"column:age_months;not null" json:"age_months"`
	AgeLabel      string  `gorm:"column:age_label;not null" json:"age_label"`
	PlannedDate   *string `gorm:"column:planned_date" json:"planned_date"`
	Status        string  `gorm:"column:status;not null" json:"status"`
	ScheduledDate *string `gorm:"column:scheduled_date" json:"scheduled_date"`
	ScheduledTime *string `gorm:"column:scheduled_time" json:"scheduled_time"`
	ClinicName    string  `gorm:"column:clinic_name;not null;default:''" json:"clinic_name"`
	VaccinatedAt  *string `gorm:"column:vaccinated_at" json:"vaccinated_at"`
	Site          string  `gorm:"column:site;not null;default:''" json:"site"`
	Manufacturer  string  `gorm:"column:manufacturer;not null;default:''" json:"manufacturer"`
	BatchNo       string  `gorm:"column:batch_no;not null;default:''" json:"batch_no"`
	Reaction      string  `gorm:"column:reaction;not null;default:''" json:"reaction"`
	Note          string  `gorm:"column:note;not null;default:''" json:"note"`
	CreatedAt     string  `gorm:"column:created_at;not null" json:"created_at"`
	UpdatedAt     string  `gorm:"column:updated_at;not null" json:"updated_at"`
}

// TableName 实现 GORM 的 Tabler 接口，显式绑定表名 vaccine_doses，避免依赖框架复数推断。
func (DoseRecord) TableName() string { return "vaccine_doses" }

// DoseView 为返回给前端的单剂完整视图：
// 通过 Go 结构体匿名嵌入 [DoseRecord]，使数据库基础字段直接展平到 JSON 顶层，
// 同时附加内置科普风险信息与按本地时区实时派生的日期/提醒状态；
// IsBirthHospital 标注 `json:"-"` 避免下发给前端，仅用于服务端聚合产院快捷确认状态。
type DoseView struct {
	DoseRecord
	ShortName         string   `json:"short_name"`
	DefaultDueDate    string   `json:"default_due_date"`
	EffectiveDate     string   `json:"effective_date"`
	AlertState        string   `json:"alert_state"`
	DaysUntil         int      `json:"days_until"`
	IsBirthHospital   bool     `json:"-"` // 仅用于服务端聚合产院快捷确认，不暴露给前端
	Deletable         bool     `json:"deletable"`
	Prevents          string   `json:"prevents"`
	Route             string   `json:"route"`
	DoseTip           string   `json:"dose_tip"`
	PrecautionsBefore []string `json:"precautions_before"`
	PrecautionsAfter  []string `json:"precautions_after"`
	RiskWarning       string   `json:"risk_warning"`
}

// NextFocus 汇总当前最需要家长关注的下一次接种焦点（按优先级与日期聚合同期剂次）。
type NextFocus struct {
	Kind          string  `json:"kind"`
	TargetDate    string  `json:"target_date"`
	DaysUntil     int     `json:"days_until"`
	AgeLabel      string  `json:"age_label"`
	ClinicName    string  `json:"clinic_name"`
	ScheduledTime string  `json:"scheduled_time"`
	DoseIDs       []int64 `json:"dose_ids"`
}

// Summary 汇总疫苗分类完成度、提醒计数与产院两针快捷确认状态。
type Summary struct {
	ScheduledCount        int        `json:"scheduled_count"`
	NIPTotal              int        `json:"nip_total"`
	NIPCompleted          int        `json:"nip_completed"`
	OptionalTotal         int        `json:"optional_total"`
	OptionalCompleted     int        `json:"optional_completed"`
	OverdueCount          int        `json:"overdue_count"`
	DueSoonCount          int        `json:"due_soon_count"`
	ScheduledSoonCount    int        `json:"scheduled_soon_count"`
	ScheduledOverdueCount int        `json:"scheduled_overdue_count"`
	BirthConfirmPending   bool       `json:"birth_confirm_pending"`
	BirthPendingDoseIDs   []int64    `json:"birth_pending_dose_ids"`
	NextFocus             *NextFocus `json:"next_focus"`
}

// OverviewResponse 表示 GET /api/vaccines 的完整响应体。
type OverviewResponse struct {
	Today         string     `json:"today"`
	BirthDate     string     `json:"birth_date"`
	Disclaimer    string     `json:"disclaimer"`
	Summary       Summary    `json:"summary"`
	RecentClinics []string   `json:"recent_clinics"`
	Doses         []DoseView `json:"doses"`
}

// CatalogDoseItem 表示内置自费模板中各默认剂次的月龄与简要提示，用于前端展示与编辑预填。
type CatalogDoseItem struct {
	DoseNumber int    `json:"dose_number"`
	AgeMonths  int    `json:"age_months"`
	AgeLabel   string `json:"age_label"`
	DoseTip    string `json:"dose_tip"`
}

// CatalogItem 表示自费疫苗模板库中的单个疫苗条目及其加入状态与默认排期。
type CatalogItem struct {
	Code           string            `json:"code"`
	Name           string            `json:"name"`
	Prevents       string            `json:"prevents"`
	Route          string            `json:"route"`
	RiskWarning    string            `json:"risk_warning"`
	DoseCount      int               `json:"dose_count"`
	Added          bool              `json:"added"`
	AddedDoseCount int               `json:"added_dose_count"`
	Doses          []CatalogDoseItem `json:"doses"`
}

// CatalogResponse 表示 GET /api/vaccines/catalog 的响应体。
type CatalogResponse struct {
	Disclaimer string        `json:"disclaimer"`
	Templates  []CatalogItem `json:"templates"`
}

// DosePlanInput 表示单剂排期输入（用于自费模板定制与多剂自定义疫苗创建，按数组顺序自动编号 1..N）。
type DosePlanInput struct {
	AgeMonths   int     `json:"age_months"`
	PlannedDate *string `json:"planned_date"`
}

// CreateCustomInput 表示新增自定义疫苗（单剂或多剂序列）的请求载荷。
type CreateCustomInput struct {
	VaccineName string          `json:"vaccine_name"`
	Category    string          `json:"category"`
	Note        string          `json:"note"`
	Doses       []DosePlanInput `json:"doses"`
}

// AddTemplateInput 表示从内置自费模板库加入疫苗的请求载荷；
// Doses 为空时采用模板默认排期，非空时按用户定制的剂次与月龄顺序创建。
type AddTemplateInput struct {
	TemplateCode string          `json:"template_code"`
	Doses        []DosePlanInput `json:"doses"`
}

// UpdateDoseInput 表示更新单剂疫苗状态、预约信息、接种记录、适龄月龄或预计日期的请求载荷。
type UpdateDoseInput struct {
	Status        string  `json:"status"`
	AgeMonths     *int    `json:"age_months"`
	PlannedDate   *string `json:"planned_date"`
	ScheduledDate *string `json:"scheduled_date"`
	ScheduledTime *string `json:"scheduled_time"`
	ClinicName    string  `json:"clinic_name"`
	VaccinatedAt  *string `json:"vaccinated_at"`
	Site          string  `json:"site"`
	Manufacturer  string  `json:"manufacturer"`
	BatchNo       string  `json:"batch_no"`
	Reaction      string  `json:"reaction"`
	Note          string  `json:"note"`
}

// BatchUpdateInput 表示同月龄批量预约或批量标记已接种的请求载荷。
// ClinicName 与 Note 采用 Go 的 *string 指针三态惯用法：nil 表示请求未传（保留各剂原值），
// 指向空字符串表示显式清空旧值，从而区分“不修改”与“清空”。
type BatchUpdateInput struct {
	Action        string  `json:"action"`
	DoseIDs       []int64 `json:"dose_ids"`
	ScheduledDate *string `json:"scheduled_date"`
	ScheduledTime *string `json:"scheduled_time"`
	VaccinatedAt  *string `json:"vaccinated_at"`
	ClinicName    *string `json:"clinic_name"`
	Note          *string `json:"note"`
}
