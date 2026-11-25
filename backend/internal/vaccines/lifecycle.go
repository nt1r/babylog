package vaccines

// singleUpdateColumns 与 batchUpdateColumns 分别声明单剂与批量更新的显式 Select 列清单：
// GORM 默认 Updates(&struct) 会跳过零值与 nil 指针，必须显式列出变更列，确保跨状态切换时废弃列落库为 NULL 或空串。
var (
	singleUpdateColumns = []string{
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
	}
	batchUpdateColumns = []string{
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
	}
)

// isProtectedNIP 判断剂次是否属于受保护的国家免疫规划内置基础剂次：
// 凡带模板编码且分类为 nip 的剂次均不可硬删，且锁定标准适龄月龄；
// 自费模板及家长自定义剂次（TemplateCode == nil，即使分类选免费）均不受此限制。
func (r DoseRecord) isProtectedNIP() bool {
	return r.TemplateCode != nil && r.Category == CategoryNIP
}

// isProtectedNIP 判断内置疫苗模板是否属于国家免疫规划基础疫苗（禁止整套移出）。
func (t vaccineTemplate) isProtectedNIP() bool {
	return t.Category == CategoryNIP
}

// matchTemplateDose 将持久化剂次关联回内置疫苗模板与对应剂次元数据：
// 未增删剂次总数时按剂次序号精确匹配；若家长定制或删改过自费模板剂次数，则按适龄月龄回退匹配，避免序号错位。
func matchTemplateDose(rec DoseRecord) (vaccineTemplate, *templateDose, bool) {
	if rec.TemplateCode == nil {
		return vaccineTemplate{}, nil, false
	}
	tpl, ok := lookupTemplate(*rec.TemplateCode)
	if !ok {
		return vaccineTemplate{}, nil, false
	}
	if rec.TotalDoses == len(tpl.Doses) {
		for i := range tpl.Doses {
			if tpl.Doses[i].DoseNumber == rec.DoseNumber {
				return tpl, &tpl.Doses[i], true
			}
		}
	} else {
		for i := range tpl.Doses {
			if tpl.Doses[i].AgeMonths == rec.AgeMonths {
				return tpl, &tpl.Doses[i], true
			}
		}
	}
	return tpl, nil, true
}

// isBirthHospitalDose 判断单剂记录是否属于产院出生疫苗（乙肝第 1 剂或卡介苗），
// 复用 matchTemplateDose 统一模板匹配口径，用于避免补录产院名称时自动覆盖宝宝常规社区接种门诊。
func (r DoseRecord) isBirthHospitalDose() bool {
	_, dose, ok := matchTemplateDose(r)
	return ok && dose != nil && dose.IsBirthHospital
}

func (r *DoseRecord) clearScheduleFields() {
	r.ScheduledDate = nil
	r.ScheduledTime = nil
}

func (r *DoseRecord) clearCompletionFields() {
	r.VaccinatedAt = nil
	r.Site = ""
	r.Manufacturer = ""
	r.BatchNo = ""
	r.Reaction = ""
}

// applySingleUpdate 按单剂全量覆写契约执行三态状态流转并清空跨状态废弃字段：
//   - pending：保留预计日期与备注，清空预约、门诊与接种记录字段；
//   - scheduled：写入预约日期/时间与门诊，清空接种记录字段；
//   - completed：写入实际接种日期、门诊与接种细节，清空预约字段。
//
// 仅对非受保护 NIP 剂次放行适龄月龄修改（对内置 NIP 传入 age_months 静默保持既有月龄），
// 且仅当月龄确实变化时重算 AgeLabel，以保留模板定制阶段文案（如流感「6月龄起」）。
func (r *DoseRecord) applySingleUpdate(norm UpdateDoseInput, nowStr string) {
	if norm.AgeMonths != nil && !r.isProtectedNIP() && *norm.AgeMonths != r.AgeMonths {
		r.AgeMonths = *norm.AgeMonths
		r.AgeLabel = formatAgeLabel(*norm.AgeMonths)
	}

	r.Status = norm.Status
	r.PlannedDate = norm.PlannedDate
	r.Note = norm.Note
	r.UpdatedAt = nowStr

	switch norm.Status {
	case StatusPending:
		r.clearScheduleFields()
		r.clearCompletionFields()
		r.ClinicName = ""
	case StatusScheduled:
		r.ScheduledDate = norm.ScheduledDate
		r.ScheduledTime = norm.ScheduledTime
		r.ClinicName = norm.ClinicName
		r.clearCompletionFields()
	case StatusCompleted:
		r.clearScheduleFields()
		r.VaccinatedAt = norm.VaccinatedAt
		r.ClinicName = norm.ClinicName
		r.Site = norm.Site
		r.Manufacturer = norm.Manufacturer
		r.BatchNo = norm.BatchNo
		r.Reaction = norm.Reaction
	}
}

// applyBatchUpdate 按批量操作契约执行状态流转（与单剂全量覆写刻意区分）：
//   - schedule：写入预约信息并清空接种细节（保留 PlannedDate）；
//   - complete：写入实际接种日期并清空预约字段，但刻意保留各剂已填的部位/厂家/批号/反应；
//   - ClinicName 与 Note 遵循 *string 三态语义（nil 保留各剂原值，非 nil 覆写或清空）。
func (r *DoseRecord) applyBatchUpdate(norm BatchUpdateInput, nowStr string) {
	switch norm.Action {
	case BatchActionSchedule:
		r.Status = StatusScheduled
		r.ScheduledDate = norm.ScheduledDate
		r.ScheduledTime = norm.ScheduledTime
		r.clearCompletionFields()
	case BatchActionComplete:
		r.Status = StatusCompleted
		r.VaccinatedAt = norm.VaccinatedAt
		r.clearScheduleFields()
	}
	if norm.ClinicName != nil {
		r.ClinicName = *norm.ClinicName
	}
	if norm.Note != nil {
		r.Note = *norm.Note
	}
	r.UpdatedAt = nowStr
}

// projectDoseViews 使用单次请求采样的 todayKey 批量投影剂次视图，保证同一响应内所有剂次自然日口径一致。
func projectDoseViews(records []DoseRecord, birthDate, todayKey string) []DoseView {
	views := make([]DoseView, 0, len(records))
	for _, rec := range records {
		views = append(views, buildDoseView(rec, birthDate, todayKey))
	}
	return views
}
