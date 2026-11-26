package integration_test

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// Scenario 是基于真实对外 HTTP API 的可配置场景数据生成器。
// 每个步骤使用合理业务默认值并允许按需覆写关键字段，前置步骤失败时立即终止当前用例，绝不直接向 SQLite 插行造数。
type Scenario struct {
	t        *testing.T
	client   *AppClient
	clientFn func() *AppClient
	babyID   int64
}

// activeClient 返回当前生效的客户端视图；优先通过 clientFn 动态读取，确保 app.Relogin() 后自动衔接新会话。
func (s *Scenario) activeClient() *AppClient {
	if s.clientFn != nil {
		return s.clientFn()
	}
	return s.client
}

// ForBaby 返回绑定指定 babyID 的场景副本，便于同一用户在多宝宝场景下向不同宝宝写入前置数据。
func (s *Scenario) ForBaby(babyID int64) *Scenario {
	cp := *s
	cp.babyID = babyID
	return &cp
}

func (s *Scenario) requireBabyID() int64 {
	s.t.Helper()
	if s.babyID <= 0 {
		s.t.Fatal("Scenario 尚未绑定 babyID，请先调用 EnsureBaby 或 ForBaby")
	}
	return s.babyID
}

// BabyParams 定义创建宝宝档案时的可选覆写参数；零值字段沿用默认档案（小汤圆、2026-07-15、female、3.35kg / 50.2cm）。
// 设置 WithoutBirthMeasurements=true 可跳过出生体重与身高默认值，用于冷启动无出生体格兜底场景。
type BabyParams struct {
	Nickname                 string
	BirthDate                string
	Gender                   string
	BirthWeightKg            *float64
	BirthHeightCm            *float64
	WithoutBirthMeasurements bool
	Timezone                 string
}

// EnsureBaby 经 POST /api/babies 创建宝宝档案并将新 ID 记录为当前场景默认宝宝。
func (s *Scenario) EnsureBaby(params ...BabyParams) baby.Profile {
	s.t.Helper()

	var p BabyParams
	if len(params) > 0 {
		p = params[0]
	}
	if p.Nickname == "" {
		p.Nickname = "小汤圆"
	}
	if p.BirthDate == "" {
		p.BirthDate = "2026-07-15"
	}
	if p.Gender == "" {
		p.Gender = "female"
	}
	if !p.WithoutBirthMeasurements {
		if p.BirthWeightKg == nil {
			p.BirthWeightKg = ptr(3.35)
		}
		if p.BirthHeightCm == nil {
			p.BirthHeightCm = ptr(50.2)
		}
	}
	tz := p.Timezone
	if tz == "" {
		tz = defaultTimezone
	}

	resp := s.activeClient().Post(s.t, "/api/babies?tz="+url.QueryEscape(tz), baby.UpsertInput{
		Nickname:      p.Nickname,
		BirthDate:     p.BirthDate,
		Gender:        p.Gender,
		BirthWeightKg: p.BirthWeightKg,
		BirthHeightCm: p.BirthHeightCm,
	})
	created := DecodeStatus[struct {
		Baby baby.Profile `json:"baby"`
	}](s.t, resp, http.StatusCreated).Baby
	s.babyID = created.ID
	return created
}

// UpdateBaby 经 PUT /api/babies/:babyId 更新当前宝宝档案并断言返回 200，用于跨模块联动（如更正出生日期）场景。
func (s *Scenario) UpdateBaby(in baby.UpsertInput, tz ...string) baby.Profile {
	s.t.Helper()
	resp := s.activeClient().Put(s.t, fmt.Sprintf("/api/babies/%d?tz=%s", s.requireBabyID(), url.QueryEscape(resolveTZ(tz))), in)
	return DecodeOK[struct {
		Baby baby.Profile `json:"baby"`
	}](s.t, resp).Baby
}

func (s *Scenario) AddFeeding(in records.FeedingInput) records.FeedingRecord {
	s.t.Helper()
	resp := s.activeClient().Post(s.t, babyPath(s.requireBabyID(), "/records/feeding"), in)
	return DecodeStatus[struct {
		Record records.FeedingRecord `json:"record"`
	}](s.t, resp, http.StatusCreated).Record
}

func (s *Scenario) AddFormula(amountML int, recordedAt string, note ...string) records.FeedingRecord {
	s.t.Helper()
	return s.AddFeeding(records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   ptr(amountML),
		RecordedAt: recordedAt,
		Note:       firstString(note),
	})
}

func (s *Scenario) AddDirectBreast(side string, durationMin int, recordedAt string, note ...string) records.FeedingRecord {
	s.t.Helper()
	return s.AddFeeding(records.FeedingInput{
		Subtype:     records.FeedingSubtypeBreast,
		FeedingMode: ptr("direct"),
		BreastSide:  ptr(side),
		DurationMin: ptr(durationMin),
		RecordedAt:  recordedAt,
		Note:        firstString(note),
	})
}

func (s *Scenario) AddBottleBreast(amountML int, recordedAt string, note ...string) records.FeedingRecord {
	s.t.Helper()
	return s.AddFeeding(records.FeedingInput{
		Subtype:     records.FeedingSubtypeBreast,
		FeedingMode: ptr("bottle"),
		AmountML:    ptr(amountML),
		RecordedAt:  recordedAt,
		Note:        firstString(note),
	})
}

// AddSolid 写入辅食记录；amount 与 acceptance 为空字符串时按未填写处理。
func (s *Scenario) AddSolid(food, amount, acceptance, recordedAt string) records.FeedingRecord {
	s.t.Helper()
	in := records.FeedingInput{
		Subtype:    records.FeedingSubtypeSolid,
		SolidFood:  ptr(food),
		RecordedAt: recordedAt,
	}
	if amount != "" {
		in.SolidAmount = ptr(amount)
	}
	if acceptance != "" {
		in.Acceptance = ptr(acceptance)
	}
	return s.AddFeeding(in)
}

func (s *Scenario) AddSleep(subtype, startedAt, endedAt string, note ...string) records.SleepRecord {
	s.t.Helper()
	resp := s.activeClient().Post(s.t, babyPath(s.requireBabyID(), "/records/sleep"), records.SleepInput{
		Subtype:   subtype,
		StartedAt: startedAt,
		EndedAt:   endedAt,
		Note:      firstString(note),
	})
	return DecodeStatus[struct {
		Record records.SleepRecord `json:"record"`
	}](s.t, resp, http.StatusCreated).Record
}

func (s *Scenario) AddCare(in records.CareInput) records.CareRecord {
	s.t.Helper()
	resp := s.activeClient().Post(s.t, babyPath(s.requireBabyID(), "/records/care"), in)
	return DecodeStatus[struct {
		Record records.CareRecord `json:"record"`
	}](s.t, resp, http.StatusCreated).Record
}

// AddDiaper 写入换尿布记录；stoolConsistency 与 stoolColor 留空时按未填写处理。
func (s *Scenario) AddDiaper(kind, stoolConsistency, stoolColor, recordedAt string) records.CareRecord {
	s.t.Helper()
	in := records.CareInput{
		Subtype:    records.CareSubtypeDiaper,
		DiaperKind: ptr(kind),
		RecordedAt: recordedAt,
	}
	if stoolConsistency != "" {
		in.StoolConsistency = ptr(stoolConsistency)
	}
	if stoolColor != "" {
		in.StoolColor = ptr(stoolColor)
	}
	return s.AddCare(in)
}

func (s *Scenario) AddBath(recordedAt string) records.CareRecord {
	s.t.Helper()
	return s.AddCare(records.CareInput{
		Subtype:    records.CareSubtypeBath,
		RecordedAt: recordedAt,
	})
}

func (s *Scenario) AddOtherCare(title, recordedAt string) records.CareRecord {
	s.t.Helper()
	return s.AddCare(records.CareInput{
		Subtype:    records.CareSubtypeOther,
		CareTitle:  ptr(title),
		RecordedAt: recordedAt,
	})
}

func (s *Scenario) AddHealth(in records.HealthInput) records.HealthRecord {
	s.t.Helper()
	resp := s.activeClient().Post(s.t, babyPath(s.requireBabyID(), "/records/health"), in)
	return DecodeStatus[struct {
		Record records.HealthRecord `json:"record"`
	}](s.t, resp, http.StatusCreated).Record
}

func (s *Scenario) AddTemperature(tempC float64, recordedAt string) records.HealthRecord {
	s.t.Helper()
	return s.AddHealth(records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: ptr(tempC),
		RecordedAt:   recordedAt,
	})
}

// AddMedicine 写入用药记录；dosage 留空时按未填写（nil）处理。
func (s *Scenario) AddMedicine(name, dosage, recordedAt string) records.HealthRecord {
	s.t.Helper()
	in := records.HealthInput{
		Subtype:      records.HealthSubtypeMedicine,
		MedicineName: ptr(name),
		RecordedAt:   recordedAt,
	}
	if dosage != "" {
		in.MedicineDosage = ptr(dosage)
	}
	return s.AddHealth(in)
}

// GrowthParams 定义体格生长记录的可选测量值（至少填写一项）。
type GrowthParams struct {
	WeightKg   *float64
	HeightCm   *float64
	HeadCm     *float64
	RecordedAt string
	Note       string
}

func (s *Scenario) AddGrowth(p GrowthParams) records.HealthRecord {
	s.t.Helper()
	return s.AddHealth(records.HealthInput{
		Subtype:    records.HealthSubtypeGrowth,
		WeightKg:   p.WeightKg,
		HeightCm:   p.HeightCm,
		HeadCm:     p.HeadCm,
		RecordedAt: p.RecordedAt,
		Note:       p.Note,
	})
}

func (s *Scenario) AddTooth(toothNote, recordedAt string) records.HealthRecord {
	s.t.Helper()
	return s.AddHealth(records.HealthInput{
		Subtype:    records.HealthSubtypeTeeth,
		ToothNote:  ptr(toothNote),
		RecordedAt: recordedAt,
	})
}

// GetVaccinesOverview 经 GET /api/babies/:babyId/vaccines 查询当前疫苗计划总览（首次访问时自动幂等初始化 NIP 基线）。
func (s *Scenario) GetVaccinesOverview(tz ...string) vaccines.OverviewResponse {
	s.t.Helper()
	resp := s.activeClient().Get(s.t, babyPath(s.requireBabyID(), "/vaccines?tz="+url.QueryEscape(resolveTZ(tz))))
	return DecodeOK[vaccines.OverviewResponse](s.t, resp)
}

// SeedVaccines 语义化别名，用于在用例前置阶段显式表达首次触发宝宝 NIP 疫苗基线的懒初始化。
func (s *Scenario) SeedVaccines(tz ...string) vaccines.OverviewResponse {
	s.t.Helper()
	return s.GetVaccinesOverview(tz...)
}

// AddVaccineTemplateInput 按完整参数与可选时区加入自费疫苗模板（支持定制 planned_date）。
func (s *Scenario) AddVaccineTemplateInput(in vaccines.AddTemplateInput, tz ...string) []vaccines.DoseView {
	s.t.Helper()
	resp := s.activeClient().Post(s.t, babyPath(s.requireBabyID(), "/vaccines/from-template?tz="+url.QueryEscape(resolveTZ(tz))), in)
	return DecodeStatus[struct {
		Doses []vaccines.DoseView `json:"doses"`
	}](s.t, resp, http.StatusCreated).Doses
}

// AddVaccineTemplate 快捷加入自费模板；不传 customAgeMonths 时采用模板默认排期，传入则按指定月龄定制剂次。
func (s *Scenario) AddVaccineTemplate(code string, customAgeMonths ...int) []vaccines.DoseView {
	s.t.Helper()
	in := vaccines.AddTemplateInput{TemplateCode: code}
	for _, m := range customAgeMonths {
		in.Doses = append(in.Doses, vaccines.DosePlanInput{AgeMonths: m})
	}
	return s.AddVaccineTemplateInput(in)
}

func (s *Scenario) AddCustomVaccine(in vaccines.CreateCustomInput, tz ...string) []vaccines.DoseView {
	s.t.Helper()
	resp := s.activeClient().Post(s.t, babyPath(s.requireBabyID(), "/vaccines?tz="+url.QueryEscape(resolveTZ(tz))), in)
	return DecodeStatus[struct {
		Doses []vaccines.DoseView `json:"doses"`
	}](s.t, resp, http.StatusCreated).Doses
}

// UpdateVaccineDose 经 PUT /api/babies/:babyId/vaccines/:id 更新单剂疫苗并返回最新视图。
func (s *Scenario) UpdateVaccineDose(id int64, in vaccines.UpdateDoseInput, tz ...string) vaccines.DoseView {
	s.t.Helper()
	resp := s.activeClient().Put(s.t, babyPath(s.requireBabyID(), fmt.Sprintf("/vaccines/%d?tz=%s", id, url.QueryEscape(resolveTZ(tz)))), in)
	return DecodeOK[struct {
		Dose vaccines.DoseView `json:"dose"`
	}](s.t, resp).Dose
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func resolveTZ(tz []string) string {
	if zone := firstString(tz); zone != "" {
		return zone
	}
	return defaultTimezone
}
