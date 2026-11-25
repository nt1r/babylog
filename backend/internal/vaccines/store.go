package vaccines

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// Store 封装疫苗计划与接种记录的 SQLite 持久化操作。
type Store struct {
	db  *gorm.DB
	now func() time.Time
}

// NewStore 创建疫苗数据存储 [Store] 实例。
func NewStore(db *gorm.DB) *Store {
	return &Store{
		db:  db,
		now: time.Now,
	}
}

// WithClock 替换 [Store] 内部时钟函数，支持在测试中固定“今天”的自然日边界，并返回自身便于链式调用。
func (s *Store) WithClock(fn func() time.Time) *Store {
	if fn != nil {
		s.now = fn
	}
	return s
}

// resolveLocation 兜底回退至服务端默认时区，避免各入口重复判断 loc == nil。
func resolveLocation(loc *time.Location) *time.Location {
	if loc != nil {
		return loc
	}
	fallback, _ := timeutil.LoadLocation("")
	return fallback
}

// isUniqueConstraintError 判断写入错误是否源自 SQLite 唯一索引冲突（用于并发重复加入模板映射 409）。
func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint failed")
}

// buildTemplateDoseRecords 将内置疫苗模板展开为待持久化的默认剂次行。
func buildTemplateDoseRecords(babyID int64, tpl vaccineTemplate, nowStr string) []DoseRecord {
	code := tpl.Code
	total := len(tpl.Doses)
	rows := make([]DoseRecord, 0, total)
	for _, d := range tpl.Doses {
		rows = append(rows, DoseRecord{
			BabyID:       babyID,
			TemplateCode: &code,
			DoseNumber:   d.DoseNumber,
			TotalDoses:   total,
			VaccineName:  tpl.Name,
			Category:     tpl.Category,
			AgeMonths:    d.AgeMonths,
			AgeLabel:     d.AgeLabel,
			Status:       StatusPending,
			CreatedAt:    nowStr,
			UpdatedAt:    nowStr,
		})
	}
	return rows
}

// EnsureNIPSeeded 为指定宝宝幂等地初始化国家免疫规划基础剂次（22 剂，全部为 pending 状态）。
// 先以只读 Count 快速跳过，避免每次 GET 查询都开启 SQLite 写事务；写路径再用部分唯一索引兜底防并发重复。
func (s *Store) EnsureNIPSeeded(ctx context.Context, babyID int64) error {
	var nipCount int64
	if err := s.db.WithContext(ctx).
		Model(&DoseRecord{}).
		Where("baby_id = ? AND category = ? AND template_code IS NOT NULL", babyID, CategoryNIP).
		Count(&nipCount).Error; err != nil {
		return err
	}
	if nipCount > 0 {
		return nil
	}

	nowStr := timeutil.FormatUTC(s.now())
	rows := make([]DoseRecord, 0, 24)
	for _, tpl := range nipTemplates() {
		rows = append(rows, buildTemplateDoseRecords(babyID, tpl, nowStr)...)
	}

	// 配合 00003_vaccines.sql 的部分唯一索引使用 ON CONFLICT DO NOTHING，确保多请求并发首访时幂等不报错。
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
	})
}

// GetOverview 返回宝宝完整疫苗计划、进度摘要、下一步焦点、常去接种门诊及最近常用接种地点。
// defaultClinicName 由外层中间件注入的宝宝档案透传，避免重复查询 baby_profiles 表。
func (s *Store) GetOverview(ctx context.Context, babyID int64, birthDate string, defaultClinicName string, loc *time.Location) (*OverviewResponse, error) {
	loc = resolveLocation(loc)
	if err := s.EnsureNIPSeeded(ctx, babyID); err != nil {
		return nil, err
	}

	// 同月龄优先展示免费国家免疫规划疫苗（nip），其后按剂次序号与主键稳定排序。
	var records []DoseRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ?", babyID).
		Order("age_months ASC, CASE WHEN category = 'nip' THEN 0 ELSE 1 END ASC, dose_number ASC, id ASC").
		Find(&records).Error; err != nil {
		return nil, err
	}

	todayKey := timeutil.LocalDateKey(s.now(), loc)
	views := make([]DoseView, 0, len(records))
	for _, rec := range records {
		views = append(views, buildDoseView(rec, birthDate, todayKey))
	}

	clinics, err := s.readRecentClinics(ctx, babyID)
	if err != nil {
		return nil, err
	}

	return &OverviewResponse{
		Today:             todayKey,
		BirthDate:         birthDate,
		Disclaimer:        medicalDisclaimer,
		DefaultClinicName: strings.TrimSpace(defaultClinicName),
		Summary:           buildSummary(views),
		RecentClinics:     clinics,
		Doses:             views,
	}, nil
}

// GetOptionalCatalog 返回内置自费疫苗模板库（含各剂次默认月龄明细与当前已加入剂次数）。
func (s *Store) GetOptionalCatalog(ctx context.Context, babyID int64) (*CatalogResponse, error) {
	var counts []struct {
		TemplateCode string
		DoseCount    int
	}
	if err := s.db.WithContext(ctx).
		Model(&DoseRecord{}).
		Select("template_code, COUNT(*) AS dose_count").
		Where("baby_id = ? AND template_code IS NOT NULL", babyID).
		Group("template_code").
		Find(&counts).Error; err != nil {
		return nil, err
	}
	countByCode := make(map[string]int, len(counts))
	for _, row := range counts {
		countByCode[row.TemplateCode] = row.DoseCount
	}

	templates := optionalTemplates()
	items := make([]CatalogItem, 0, len(templates))
	for _, tpl := range templates {
		doses := make([]CatalogDoseItem, 0, len(tpl.Doses))
		for _, d := range tpl.Doses {
			doses = append(doses, CatalogDoseItem{
				DoseNumber: d.DoseNumber,
				AgeMonths:  d.AgeMonths,
				AgeLabel:   d.AgeLabel,
				DoseTip:    d.DoseTip,
			})
		}
		addedCount := countByCode[tpl.Code]
		items = append(items, CatalogItem{
			Code:           tpl.Code,
			Name:           tpl.Name,
			Prevents:       tpl.Prevents,
			Route:          tpl.Route,
			RiskWarning:    tpl.RiskWarning,
			DoseCount:      len(tpl.Doses),
			Added:          addedCount > 0,
			AddedDoseCount: addedCount,
			Doses:          doses,
		})
	}

	return &CatalogResponse{
		Disclaimer: optionalCatalogDisclaimer,
		Templates:  items,
	}, nil
}

// AddFromTemplate 将指定内置自费疫苗模板加入宝宝计划：
// 若前端未传 Doses 则采用模板默认排期，否则按家长定制的剂次与月龄顺序创建 1..N 剂；
// 模板无效或排期非法返回 [*ValidationError]，已加入过则返回 [ErrTemplateAlreadyAdded]。
func (s *Store) AddFromTemplate(ctx context.Context, babyID int64, birthDate string, loc *time.Location, in AddTemplateInput) ([]DoseView, error) {
	loc = resolveLocation(loc)
	code := strings.TrimSpace(in.TemplateCode)
	tpl, ok := lookupTemplate(code)
	if !ok || tpl.Category != CategoryOptional {
		return nil, &ValidationError{Message: "未找到对应的自费疫苗模板"}
	}

	var customPlans []DosePlanInput
	if len(in.Doses) > 0 {
		var err error
		customPlans, err = validateDosePlans(in.Doses)
		if err != nil {
			return nil, err
		}
	}

	var created []DoseRecord
	nowStr := timeutil.FormatUTC(s.now())
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingCount int64
		if err := tx.Model(&DoseRecord{}).
			Where("baby_id = ? AND template_code = ?", babyID, code).
			Count(&existingCount).Error; err != nil {
			return err
		}
		if existingCount > 0 {
			return ErrTemplateAlreadyAdded
		}

		var rows []DoseRecord
		if len(customPlans) > 0 {
			total := len(customPlans)
			rows = make([]DoseRecord, 0, total)
			for i, plan := range customPlans {
				tplCode := tpl.Code
				// 若该位置月龄与模板默认一致，优先保留模板定制阶段文案（如流感「6月龄起」「首季第2剂」）。
				ageLabel := formatAgeLabel(plan.AgeMonths)
				if i < len(tpl.Doses) && tpl.Doses[i].AgeMonths == plan.AgeMonths && tpl.Doses[i].AgeLabel != "" {
					ageLabel = tpl.Doses[i].AgeLabel
				}
				rows = append(rows, DoseRecord{
					BabyID:       babyID,
					TemplateCode: &tplCode,
					DoseNumber:   i + 1,
					TotalDoses:   total,
					VaccineName:  tpl.Name,
					Category:     CategoryOptional,
					AgeMonths:    plan.AgeMonths,
					AgeLabel:     ageLabel,
					PlannedDate:  plan.PlannedDate,
					Status:       StatusPending,
					CreatedAt:    nowStr,
					UpdatedAt:    nowStr,
				})
			}
		} else {
			rows = buildTemplateDoseRecords(babyID, tpl, nowStr)
		}

		if err := tx.Create(&rows).Error; err != nil {
			if isUniqueConstraintError(err) {
				return ErrTemplateAlreadyAdded
			}
			return err
		}
		created = rows
		return nil
	})
	if err != nil {
		return nil, err
	}

	todayKey := timeutil.LocalDateKey(s.now(), loc)
	views := make([]DoseView, 0, len(created))
	for _, rec := range created {
		views = append(views, buildDoseView(rec, birthDate, todayKey))
	}
	return views, nil
}

// CreateCustom 在单一事务内新增自定义疫苗（单剂或多剂序列，自动按顺序编号 1..N）。
func (s *Store) CreateCustom(ctx context.Context, babyID int64, birthDate string, loc *time.Location, in CreateCustomInput) ([]DoseView, error) {
	loc = resolveLocation(loc)
	norm, err := validateCreateInput(in)
	if err != nil {
		return nil, err
	}

	nowStr := timeutil.FormatUTC(s.now())
	total := len(norm.Doses)
	rows := make([]DoseRecord, 0, total)
	for i, plan := range norm.Doses {
		rows = append(rows, DoseRecord{
			BabyID:      babyID,
			VaccineName: norm.VaccineName,
			Category:    norm.Category,
			DoseNumber:  i + 1,
			TotalDoses:  total,
			AgeMonths:   plan.AgeMonths,
			AgeLabel:    formatAgeLabel(plan.AgeMonths),
			PlannedDate: plan.PlannedDate,
			Status:      StatusPending,
			Note:        norm.Note,
			CreatedAt:   nowStr,
			UpdatedAt:   nowStr,
		})
	}

	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.Create(&rows).Error
	}); err != nil {
		return nil, err
	}

	todayKey := timeutil.LocalDateKey(s.now(), loc)
	views := make([]DoseView, 0, len(rows))
	for _, rec := range rows {
		views = append(views, buildDoseView(rec, birthDate, todayKey))
	}
	return views, nil
}

// UpdateDose 在单一事务内更新单剂状态、预约或接种信息（自费与自定义剂次亦支持调整适龄月龄）；
// 校验失败返回 [*ValidationError]，记录不存在返回 [ErrNotFound]。
// GORM 默认的 Updates(&struct) 会忽略零值与 nil 指针字段，因此必须显式列出 Select 列清单，
// 确保跨状态切换时（例如已接种回退待接种）废弃的可空列在 SQLite 中被真正写为 NULL 或空串。
func (s *Store) UpdateDose(ctx context.Context, babyID int64, id int64, birthDate string, loc *time.Location, in UpdateDoseInput) (*DoseView, error) {
	loc = resolveLocation(loc)
	todayKey := timeutil.LocalDateKey(s.now(), loc)
	norm, err := validateUpdateInput(in, birthDate, todayKey)
	if err != nil {
		return nil, err
	}

	var updated DoseRecord
	nowStr := timeutil.FormatUTC(s.now())
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing DoseRecord
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&existing).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

		// 仅允许对自定义或自费剂次修改适龄月龄（对内置 NIP 剂次传入 age_months 静默保持既有月龄而非报错）；
		// 仅当月龄确实变化时重算 AgeLabel，保留模板定制文案（如流感「6月龄起」）。
		if norm.AgeMonths != nil && (existing.TemplateCode == nil || existing.Category == CategoryOptional) && *norm.AgeMonths != existing.AgeMonths {
			existing.AgeMonths = *norm.AgeMonths
			existing.AgeLabel = formatAgeLabel(*norm.AgeMonths)
		}

		existing.Status = norm.Status
		existing.PlannedDate = norm.PlannedDate
		existing.ScheduledDate = norm.ScheduledDate
		existing.ScheduledTime = norm.ScheduledTime
		existing.ClinicName = norm.ClinicName
		existing.VaccinatedAt = norm.VaccinatedAt
		existing.Site = norm.Site
		existing.Manufacturer = norm.Manufacturer
		existing.BatchNo = norm.BatchNo
		existing.Reaction = norm.Reaction
		existing.Note = norm.Note
		existing.UpdatedAt = nowStr

		if err := tx.Model(&existing).Select(
			"age_months",
			"age_label",
			"status",
			"planned_date",
			"scheduled_date",
			"scheduled_time",
			"clinic_name",
			"vaccinated_at",
			"site",
			"manufacturer",
			"batch_no",
			"reaction",
			"note",
			"updated_at",
		).Updates(&existing).Error; err != nil {
			return err
		}

		if err := syncDefaultClinicTx(tx, babyID, norm.ClinicName, norm.SetDefaultClinic, !isBirthHospitalDose(existing), nowStr); err != nil {
			return err
		}
		updated = existing
		return nil
	})
	if err != nil {
		return nil, err
	}

	view := buildDoseView(updated, birthDate, todayKey)
	return &view, nil
}

// BatchUpdate 在单一事务内原子更新多剂疫苗（支持同月龄合并预约与产院/历史批量标记已接种）。
// 若任一 ID 不存在或归属不匹配，回调返回 [ErrNotFound] 触发 GORM 自动回滚整批变更；
// ClinicName 与 Note 为 nil 时保留各剂原值，显式传入空字符串时允许清空旧值。
func (s *Store) BatchUpdate(ctx context.Context, babyID int64, birthDate string, loc *time.Location, in BatchUpdateInput) ([]DoseView, error) {
	loc = resolveLocation(loc)
	todayKey := timeutil.LocalDateKey(s.now(), loc)
	norm, err := validateBatchInput(in, birthDate, todayKey)
	if err != nil {
		return nil, err
	}

	var updated []DoseRecord
	nowStr := timeutil.FormatUTC(s.now())
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []DoseRecord
		if err := tx.Where("baby_id = ? AND id IN ?", babyID, norm.DoseIDs).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(norm.DoseIDs) {
			return ErrNotFound
		}

		// hasNonBirthDose 确保纯产院出生两针批量确认时，不会把产院名称自动记为常去社区接种门诊；
		// 批量预约清空接种细节（保留 PlannedDate）；批量标记已接种清空预约字段但刻意保留各剂已填的部位/厂家/批号/反应，
		// 与单剂 UpdateDose 的全量覆写语义不同。
		hasNonBirthDose := false
		for i := range rows {
			if !isBirthHospitalDose(rows[i]) {
				hasNonBirthDose = true
			}
			if norm.Action == BatchActionSchedule {
				rows[i].Status = StatusScheduled
				rows[i].ScheduledDate = norm.ScheduledDate
				rows[i].ScheduledTime = norm.ScheduledTime
				rows[i].VaccinatedAt = nil
				rows[i].Site = ""
				rows[i].Manufacturer = ""
				rows[i].BatchNo = ""
				rows[i].Reaction = ""
			} else {
				rows[i].Status = StatusCompleted
				rows[i].VaccinatedAt = norm.VaccinatedAt
				rows[i].ScheduledDate = nil
				rows[i].ScheduledTime = nil
			}
			if norm.ClinicName != nil {
				rows[i].ClinicName = *norm.ClinicName
			}
			if norm.Note != nil {
				rows[i].Note = *norm.Note
			}
			rows[i].UpdatedAt = nowStr

			if err := tx.Model(&rows[i]).Select(
				"status",
				"scheduled_date",
				"scheduled_time",
				"clinic_name",
				"vaccinated_at",
				"site",
				"manufacturer",
				"batch_no",
				"reaction",
				"note",
				"updated_at",
			).Updates(&rows[i]).Error; err != nil {
				return err
			}
		}
		if norm.ClinicName != nil && *norm.ClinicName != "" {
			if err := syncDefaultClinicTx(tx, babyID, *norm.ClinicName, norm.SetDefaultClinic, hasNonBirthDose, nowStr); err != nil {
				return err
			}
		}
		updated = rows
		return nil
	})
	if err != nil {
		return nil, err
	}

	views := make([]DoseView, 0, len(updated))
	for _, rec := range updated {
		views = append(views, buildDoseView(rec, birthDate, todayKey))
	}
	return views, nil
}

// DeleteDose 删除单剂自定义或自费模板剂次，并在同一事务内将同疫苗剩余剂次自动连续重排（1..N-1）；
// 目标不存在返回 [ErrNotFound]，内置国家免疫规划基础剂次拒绝删除并返回 [ErrCannotDeleteNIP]。
func (s *Store) DeleteDose(ctx context.Context, babyID int64, id int64) error {
	nowStr := timeutil.FormatUTC(s.now())
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing DoseRecord
		if err := tx.Where("id = ? AND baby_id = ?", id, babyID).First(&existing).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if existing.TemplateCode != nil && existing.Category == CategoryNIP {
			return ErrCannotDeleteNIP
		}

		if err := tx.Delete(&existing).Error; err != nil {
			return err
		}

		// 查找同疫苗剩余剂次（自定义疫苗无模板码，按 vaccine_name + category 归组）并按原剂次升序依次前移编号，
		// 逐条更新保证始终满足 newNum <= oldNum，避免触发部分唯一索引中间态冲突。
		var siblings []DoseRecord
		query := tx.Where("baby_id = ?", babyID)
		if existing.TemplateCode != nil {
			query = query.Where("template_code = ?", *existing.TemplateCode)
		} else {
			query = query.Where("template_code IS NULL AND vaccine_name = ? AND category = ?", existing.VaccineName, existing.Category)
		}
		if err := query.Order("dose_number ASC, id ASC").Find(&siblings).Error; err != nil {
			return err
		}

		newTotal := len(siblings)
		for i := range siblings {
			newNum := i + 1
			if siblings[i].DoseNumber == newNum && siblings[i].TotalDoses == newTotal {
				continue
			}
			siblings[i].DoseNumber = newNum
			siblings[i].TotalDoses = newTotal
			siblings[i].UpdatedAt = nowStr
			if err := tx.Model(&siblings[i]).
				Select("dose_number", "total_doses", "updated_at").
				Updates(&siblings[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteTemplate 整套移出指定自费疫苗模板的全部剂次；
// 模板不存在或尚未加入返回 [ErrNotFound]，内置国家免疫规划模板返回 [ErrCannotDeleteNIP]。
func (s *Store) DeleteTemplate(ctx context.Context, babyID int64, templateCode string) error {
	code := strings.TrimSpace(templateCode)
	tpl, ok := lookupTemplate(code)
	if !ok {
		return ErrNotFound
	}
	if tpl.Category == CategoryNIP {
		return ErrCannotDeleteNIP
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Where("baby_id = ? AND template_code = ?", babyID, code).Delete(&DoseRecord{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// syncDefaultClinicTx 在疫苗写入事务内同步常去接种门诊：
// 显式置顶（explicitPin）时直接覆写；否则仅在目标包含非产院出生剂次（常规社区剂次）且档案尚无默认门诊时自动补写，
// 确保首次填写社区医院即生效，同时产院补录与后续偶发去其他医院不覆盖固定默认门诊。
func syncDefaultClinicTx(tx *gorm.DB, babyID int64, clinicName string, explicitPin bool, allowAutoRemember bool, nowStr string) error {
	if clinicName == "" {
		return nil
	}
	if explicitPin {
		return tx.Table("baby_profiles"). // cross-table: 同事务原子覆写宝宝常去门诊
							Where("id = ?", babyID).
							Updates(map[string]any{
				"default_clinic_name": clinicName,
				"updated_at":          nowStr,
			}).Error
	}
	if !allowAutoRemember {
		return nil
	}
	return tx.Table("baby_profiles"). // cross-table: 同事务原子补写首次常规门诊
						Where("id = ? AND default_clinic_name = ''", babyID).
						Updates(map[string]any{
			"default_clinic_name": clinicName,
			"updated_at":          nowStr,
		}).Error
}

// readRecentClinics 按最近更新时间取前 20 条记录在内存中去重，既保留「最近使用优先」顺序又避免 SQLite DISTINCT 破坏排序。
func (s *Store) readRecentClinics(ctx context.Context, babyID int64) ([]string, error) {
	var rows []struct {
		ClinicName string
	}
	if err := s.db.WithContext(ctx).
		Model(&DoseRecord{}).
		Select("clinic_name").
		Where("baby_id = ? AND clinic_name <> ''", babyID).
		Order("updated_at DESC, id DESC").
		Limit(20).
		Find(&rows).Error; err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, RecentClinicsLimit)
	clinics := make([]string, 0, RecentClinicsLimit)
	for _, row := range rows {
		name := strings.TrimSpace(row.ClinicName)
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		clinics = append(clinics, name)
		if len(clinics) >= RecentClinicsLimit {
			break
		}
	}
	return clinics, nil
}
