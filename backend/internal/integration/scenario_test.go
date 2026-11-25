package integration_test

import (
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
	t      *testing.T
	client *AppClient
}

// BabyParams 定义创建宝宝档案时的可选覆写参数；零值字段沿用默认档案（小汤圆、2026-07-15、female、3.35kg / 50.2cm）。
type BabyParams struct {
	Nickname      string
	BirthDate     string
	Gender        string
	BirthWeightKg *float64
	BirthHeightCm *float64
	Timezone      string
}

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
	if p.BirthWeightKg == nil {
		p.BirthWeightKg = ptr(3.35)
	}
	if p.BirthHeightCm == nil {
		p.BirthHeightCm = ptr(50.2)
	}
	tz := p.Timezone
	if tz == "" {
		tz = defaultTimezone
	}

	resp := s.client.Post(s.t, "/api/baby?tz="+url.QueryEscape(tz), baby.UpsertInput{
		Nickname:      p.Nickname,
		BirthDate:     p.BirthDate,
		Gender:        p.Gender,
		BirthWeightKg: p.BirthWeightKg,
		BirthHeightCm: p.BirthHeightCm,
	})
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Baby baby.Profile `json:"baby"`
	}](s.t, resp).Baby
}

func (s *Scenario) AddFeeding(in records.FeedingInput) records.FeedingRecord {
	s.t.Helper()
	resp := s.client.Post(s.t, "/api/records/feeding", in)
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Record records.FeedingRecord `json:"record"`
	}](s.t, resp).Record
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
	resp := s.client.Post(s.t, "/api/records/sleep", records.SleepInput{
		Subtype:   subtype,
		StartedAt: startedAt,
		EndedAt:   endedAt,
		Note:      firstString(note),
	})
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Record records.SleepRecord `json:"record"`
	}](s.t, resp).Record
}

func (s *Scenario) AddCare(in records.CareInput) records.CareRecord {
	s.t.Helper()
	resp := s.client.Post(s.t, "/api/records/care", in)
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Record records.CareRecord `json:"record"`
	}](s.t, resp).Record
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
	resp := s.client.Post(s.t, "/api/records/health", in)
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Record records.HealthRecord `json:"record"`
	}](s.t, resp).Record
}

func (s *Scenario) AddTemperature(tempC float64, recordedAt string) records.HealthRecord {
	s.t.Helper()
	return s.AddHealth(records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: ptr(tempC),
		RecordedAt:   recordedAt,
	})
}

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

// SeedVaccines 经 GET /api/vaccines 触发宝宝 NIP 疫苗基线的幂等懒初始化并返回完整总览。
func (s *Scenario) SeedVaccines(tz ...string) vaccines.OverviewResponse {
	s.t.Helper()
	resp := s.client.Get(s.t, "/api/vaccines?tz="+url.QueryEscape(resolveTZ(tz)))
	resp.RequireStatus(s.t, http.StatusOK)
	return DecodeJSON[vaccines.OverviewResponse](s.t, resp)
}

// AddVaccineTemplateInput 按完整参数与可选时区加入自费疫苗模板（支持定制 planned_date）。
func (s *Scenario) AddVaccineTemplateInput(in vaccines.AddTemplateInput, tz ...string) []vaccines.DoseView {
	s.t.Helper()
	resp := s.client.Post(s.t, "/api/vaccines/from-template?tz="+url.QueryEscape(resolveTZ(tz)), in)
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Doses []vaccines.DoseView `json:"doses"`
	}](s.t, resp).Doses
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
	resp := s.client.Post(s.t, "/api/vaccines?tz="+url.QueryEscape(resolveTZ(tz)), in)
	resp.RequireStatus(s.t, http.StatusCreated)
	return DecodeJSON[struct {
		Doses []vaccines.DoseView `json:"doses"`
	}](s.t, resp).Doses
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
