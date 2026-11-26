import {
  type AddVaccineTemplateInput,
  type BatchVaccineInput,
  type CreateCustomVaccineInput,
  type DosePlanInput,
  getSuggestedManufacturers,
  resolvePreferredClinic,
  type UpdateVaccineDoseInput,
  type VaccineCatalogItem,
  type VaccineCategory,
  type VaccineDose,
  type VaccineStatus,
} from '@/lib/vaccines';

export const MAX_EDITABLE_DOSES = 10;
export const MAX_AGE_MONTHS = 144;

/** 排期编辑器单行草稿（供自费模板定制与自定义多剂次疫苗共用）。 */
export interface EditableDoseRow {
  readonly key: string;
  readonly ageMonths: string;
  readonly plannedDate: string;
  readonly tip?: string;
}

/** 单剂详情抽屉的统一表单草稿。 */
export interface DoseDetailDraft {
  readonly status: VaccineStatus;
  readonly ageMonths: string;
  readonly plannedDate: string;
  readonly scheduledDate: string;
  readonly scheduledTime: string;
  readonly clinicName: string;
  readonly clinicTouched: boolean;
  readonly clinicAutoFilled: boolean;
  readonly pinAsDefault: boolean;
  readonly vaccinatedAt: string;
  readonly site: string;
  readonly manufacturer: string;
  readonly batchNo: string;
  readonly reaction: string;
  readonly detailsOpen: boolean;
  readonly note: string;
}

/** 批量预约/标记已接种抽屉的打开意图。 */
export interface BatchDrawerIntent {
  readonly action: 'schedule' | 'complete';
  readonly doseIds: readonly number[];
  readonly stageLabel: string;
  readonly defaultDate: string;
  readonly defaultClinic?: string;
}

/** 批量操作抽屉的统一表单草稿。 */
export interface BatchDoseDraft {
  readonly date: string;
  readonly time: string;
  readonly clinicName: string;
  readonly clinicAutoFilled: boolean;
  readonly preserveExistingClinicsHint: boolean;
  readonly pinAsDefault: boolean;
  readonly note: string;
}

/** 产院出生两针批量确认的单剂选择项。 */
export interface BirthConfirmItem {
  readonly dose: VaccineDose;
  readonly vaccinatedAt: string;
}

let doseRowSeq = 0;

/** 生成稳定的排期行 key，确保删减中间剂次时受控输入框状态不错位。 */
export function nextDoseRowKey(): string {
  doseRowSeq += 1;
  return `dose-row-${doseRowSeq}`;
}

/** 按内置自费模板的默认排期初始化可编辑行。 */
export function createRowsFromTemplate(tpl: VaccineCatalogItem): EditableDoseRow[] {
  return tpl.doses.map((d) => ({
    key: nextDoseRowKey(),
    ageMonths: String(d.age_months),
    plannedDate: '',
    tip: d.dose_tip,
  }));
}

/** 初始化自定义疫苗的首行默认排期（6 月龄）。 */
export function createInitialCustomRows(): EditableDoseRow[] {
  return [{ key: nextDoseRowKey(), ageMonths: '6', plannedDate: '' }];
}

function parseAgeMonthsInput(
  raw: string,
  prefix = '',
): { readonly value: number; readonly error: null } | { readonly value: null; readonly error: string } {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: `${prefix}适龄月龄请填写 0 至 ${MAX_AGE_MONTHS} 之间的整数` };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n < 0 || n > MAX_AGE_MONTHS) {
    return { value: null, error: `${prefix}适龄月龄应在 0 至 ${MAX_AGE_MONTHS} 个月之间` };
  }
  return { value: n, error: null };
}

function validateVaccinatedAtBounds(
  vaccinatedAt: string,
  birthDate: string,
  today: string,
  missingMsg: string,
): string | null {
  if (!vaccinatedAt) {
    return missingMsg;
  }
  if (vaccinatedAt > today) {
    return '实际接种日期不能晚于今天';
  }
  if (birthDate && vaccinatedAt < birthDate) {
    return '实际接种日期不能早于宝宝出生日期';
  }
  return null;
}

function shouldResetClinicPin(nextClinic: string, defaultClinicName: string): boolean {
  const trimmed = nextClinic.trim();
  return !trimmed || trimmed === defaultClinicName.trim();
}

/** 校验并解析排期行数组为后端 DosePlanInput 列表；失败时返回中文错误提示。 */
function parseEditableDoseRows(
  rows: readonly EditableDoseRow[],
): { readonly plans: DosePlanInput[]; readonly error: null } | { readonly plans: null; readonly error: string } {
  if (rows.length === 0) {
    return { plans: null, error: '请至少保留 1 剂接种排期' };
  }
  if (rows.length > MAX_EDITABLE_DOSES) {
    return { plans: null, error: `单种疫苗最多支持 ${MAX_EDITABLE_DOSES} 剂` };
  }

  const plans: DosePlanInput[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const parsedAge = parseAgeMonthsInput(row.ageMonths, `第 ${i + 1} 剂的`);
    if (parsedAge.value === null) {
      return { plans: null, error: parsedAge.error };
    }
    plans.push({
      age_months: parsedAge.value,
      planned_date: row.plannedDate.trim() || null,
    });
  }
  return { plans, error: null };
}

/**
 * 校验自费模板定制排期并构造提交载荷：
 * 若家长未偏离模板默认排期，则省略 doses 字段让后端直接按内置模板入库（完整保留各剂阶段文案）。
 */
export function validateAndBuildTemplateAdd(
  tpl: VaccineCatalogItem,
  rows: readonly EditableDoseRow[],
):
  | {
      readonly ok: true;
      readonly request: AddVaccineTemplateInput;
      readonly doseCount: number;
    }
  | { readonly ok: false; readonly error: string } {
  const parsed = parseEditableDoseRows(rows);
  if (!parsed.plans) {
    return { ok: false, error: parsed.error };
  }

  const matchesTemplateDefault =
    parsed.plans.length === tpl.doses.length &&
    parsed.plans.every((plan, idx) => plan.age_months === tpl.doses[idx]?.age_months && plan.planned_date === null);

  return {
    ok: true,
    request: {
      templateCode: tpl.code,
      ...(matchesTemplateDefault ? {} : { doses: parsed.plans }),
    },
    doseCount: parsed.plans.length,
  };
}

/** 校验并构造自定义多剂次疫苗的新增载荷。 */
export function validateAndBuildCustomVaccine(
  vaccineName: string,
  category: VaccineCategory,
  rows: readonly EditableDoseRow[],
  note: string,
): { readonly ok: true; readonly input: CreateCustomVaccineInput } | { readonly ok: false; readonly error: string } {
  const trimmedName = vaccineName.trim();
  if (!trimmedName) {
    return { ok: false, error: '请填写疫苗名称' };
  }
  const parsed = parseEditableDoseRows(rows);
  if (!parsed.plans) {
    return { ok: false, error: parsed.error };
  }
  return {
    ok: true,
    input: {
      vaccine_name: trimmedName,
      category,
      note: note.trim(),
      doses: parsed.plans,
    },
  };
}

/** 创建空的单剂详情初始草稿（抽屉首次打开前占位）。 */
export function createEmptyDoseDetailDraft(): DoseDetailDraft {
  return {
    status: 'pending',
    ageMonths: '0',
    plannedDate: '',
    scheduledDate: '',
    scheduledTime: '',
    clinicName: '',
    clinicTouched: false,
    clinicAutoFilled: false,
    pinAsDefault: false,
    vaccinatedAt: '',
    site: '',
    manufacturer: '',
    batchNo: '',
    reaction: '',
    detailsOpen: false,
    note: '',
  };
}

/**
 * 按选中的疫苗剂次初始化详情草稿：
 * - 实际接种日回填优先级：已有实打日期 > 未晚于今天的预计/预约日期 > 今天；
 * - 口服疫苗默认填充「口服」接种部位；
 * - 已有绿本厂家/批号/反应或同苗存在历史推荐厂家时默认展开补充区。
 */
export function createDoseDetailDraft(
  dose: VaccineDose,
  ctx: { readonly allDoses: readonly VaccineDose[]; readonly today: string },
): DoseDetailDraft {
  let defaultVacDate = ctx.today;
  if (dose.vaccinated_at) {
    defaultVacDate = dose.vaccinated_at;
  } else if (dose.effective_date <= ctx.today) {
    defaultVacDate = dose.effective_date;
  }

  const hasSiblingMakers = getSuggestedManufacturers(dose, ctx.allDoses).length > 0;
  return {
    status: dose.status,
    ageMonths: String(dose.age_months),
    // plannedDate 仅保存手动覆盖值；为空时输入框回显 default_due_date，提交仍传 null 以保持出生日期变更联动。
    plannedDate: dose.planned_date ?? '',
    scheduledDate: dose.scheduled_date ?? dose.effective_date,
    scheduledTime: dose.scheduled_time ?? '',
    clinicName: dose.clinic_name,
    clinicTouched: false,
    clinicAutoFilled: false,
    pinAsDefault: false,
    vaccinatedAt: defaultVacDate,
    site: dose.site || (dose.route.includes('口服') ? '口服' : ''),
    manufacturer: dose.manufacturer,
    batchNo: dose.batch_no,
    reaction: dose.reaction,
    detailsOpen: Boolean(dose.manufacturer || dose.batch_no || dose.reaction || hasSiblingMakers),
    note: dose.note,
  };
}

/** 更新单剂详情草稿的接种地点；输入清空或切回当前默认门诊时同步复位 pinAsDefault，防止隐藏复选框残留旧勾选态。 */
export function applyDetailClinicChange(
  draft: DoseDetailDraft,
  nextValue: string,
  defaultClinicName: string,
): DoseDetailDraft {
  return {
    ...draft,
    clinicName: nextValue,
    clinicTouched: true,
    clinicAutoFilled: false,
    pinAsDefault: shouldResetClinicPin(nextValue, defaultClinicName) ? false : draft.pinAsDefault,
  };
}

/**
 * 切换单剂详情状态：
 * 从「待接种」切入「已预约/已接种」且未手改地点时自动预填常去/最近门诊；
 * 切入「已接种」且同苗有历史厂家时自动展开绿本补充区。
 */
export function applyDetailStatusChange(
  draft: DoseDetailDraft,
  nextStatus: VaccineStatus,
  dose: VaccineDose | null,
  ctx: {
    readonly allDoses: readonly VaccineDose[];
    readonly defaultClinicName: string;
    readonly recentClinics: readonly string[];
  },
): DoseDetailDraft {
  let clinicName = draft.clinicName;
  let clinicAutoFilled = draft.clinicAutoFilled;
  if (draft.status === 'pending' && nextStatus !== 'pending' && !draft.clinicTouched && !draft.clinicName.trim()) {
    const preferred = resolvePreferredClinic(ctx.defaultClinicName, ctx.recentClinics);
    if (preferred) {
      clinicName = preferred;
      clinicAutoFilled = true;
    }
  }

  let detailsOpen = draft.detailsOpen;
  if (nextStatus === 'completed' && dose && getSuggestedManufacturers(dose, ctx.allDoses).length > 0) {
    detailsOpen = true;
  }

  return {
    ...draft,
    status: nextStatus,
    clinicName,
    clinicAutoFilled,
    detailsOpen,
  };
}

/** 校验单剂详情草稿并组装全量覆写提交载荷（仅校验当前激活状态下可见字段）。 */
export function validateAndBuildDoseUpdate(
  draft: DoseDetailDraft,
  dose: VaccineDose,
  ctx: { readonly birthDate: string; readonly today: string },
):
  | { readonly ok: true; readonly input: UpdateVaccineDoseInput; readonly toastTitle: string }
  | { readonly ok: false; readonly error: string } {
  if (draft.status === 'scheduled' && !draft.scheduledDate) {
    return { ok: false, error: '登记预约时请选择预约日期' };
  }
  if (draft.status === 'completed') {
    const vacErr = validateVaccinatedAtBounds(
      draft.vaccinatedAt,
      ctx.birthDate,
      ctx.today,
      '标记已接种时请选择实际接种日期',
    );
    if (vacErr) {
      return { ok: false, error: vacErr };
    }
  }

  // 适龄月龄输入框仅在 pending 态且可编辑剂次上渲染，非 pending 态不校验也不下发。
  let parsedAgeMonths: number | undefined;
  if (draft.status === 'pending' && dose.deletable) {
    const parsedAge = parseAgeMonthsInput(draft.ageMonths);
    if (parsedAge.value === null) {
      return { ok: false, error: parsedAge.error };
    }
    parsedAgeMonths = parsedAge.value;
  }

  const trimmedClinic = draft.clinicName.trim();
  const input: UpdateVaccineDoseInput = {
    status: draft.status,
    age_months: parsedAgeMonths,
    planned_date: draft.plannedDate.trim() || null,
    // 按目标状态显式清空非当前态字段，与后端 UpdateDose 全量覆写契约对齐。
    scheduled_date: draft.status === 'scheduled' ? draft.scheduledDate : null,
    scheduled_time: draft.status === 'scheduled' ? draft.scheduledTime.trim() || null : null,
    clinic_name: draft.status === 'pending' ? '' : trimmedClinic,
    set_default_clinic: draft.status !== 'pending' && Boolean(trimmedClinic) && draft.pinAsDefault,
    vaccinated_at: draft.status === 'completed' ? draft.vaccinatedAt : null,
    site: draft.status === 'completed' ? draft.site.trim() : '',
    manufacturer: draft.status === 'completed' ? draft.manufacturer.trim() : '',
    batch_no: draft.status === 'completed' ? draft.batchNo.trim() : '',
    reaction: draft.status === 'completed' ? draft.reaction.trim() : '',
    note: draft.note.trim(),
  };

  const toastTitle =
    draft.status === 'completed'
      ? '接种记录已保存'
      : draft.status === 'scheduled'
        ? '疫苗预约已登记'
        : '疫苗计划已更新';

  return { ok: true, input, toastTitle };
}

/** 创建空的批量操作初始草稿（抽屉首次打开前占位）。 */
export function createEmptyBatchDoseDraft(): BatchDoseDraft {
  return {
    date: '',
    time: '',
    clinicName: '',
    clinicAutoFilled: false,
    preserveExistingClinicsHint: false,
    pinAsDefault: false,
    note: '',
  };
}

/**
 * 按批量意图与目标剂次集合初始化批量草稿：
 * 门诊预填三级优先级：
 * 1. 已预约焦点显式传入 bookedClinic 或全部目标剂次共用同一既有门诊 -> 直接沿用；
 * 2. 目标剂次存在部分/混杂既有门诊 -> 留空并展示保留提示，遵守后端 *string 留空不覆写语义；
 * 3. 目标剂次均尚无门诊 -> 自动预填常去门诊（或最近门诊）。
 */
export function createBatchDoseDraft(
  intent: BatchDrawerIntent,
  ctx: {
    readonly allDoses: readonly VaccineDose[];
    readonly today: string;
    readonly defaultClinicName: string;
    readonly recentClinics: readonly string[];
  },
): BatchDoseDraft {
  const date =
    intent.action === 'complete' && intent.defaultDate > ctx.today ? ctx.today : intent.defaultDate || ctx.today;

  const matchedDoses = ctx.allDoses.filter((d) => intent.doseIds.includes(d.id));
  const distinctExisting = Array.from(new Set(matchedDoses.map((d) => d.clinic_name.trim()).filter(Boolean)));
  const allHaveClinic = matchedDoses.length > 0 && matchedDoses.every((d) => Boolean(d.clinic_name.trim()));
  const bookedClinic = intent.defaultClinic?.trim() ?? '';

  let clinicName = '';
  let clinicAutoFilled = false;
  let preserveExistingClinicsHint = false;

  if (bookedClinic) {
    clinicName = bookedClinic;
  } else if (distinctExisting.length === 1 && allHaveClinic) {
    clinicName = distinctExisting[0];
  } else if (distinctExisting.length > 0) {
    preserveExistingClinicsHint = true;
  } else {
    const preferred = resolvePreferredClinic(ctx.defaultClinicName, ctx.recentClinics);
    clinicName = preferred;
    clinicAutoFilled = Boolean(preferred);
  }

  return {
    date,
    time: '',
    clinicName,
    clinicAutoFilled,
    preserveExistingClinicsHint,
    pinAsDefault: false,
    note: '',
  };
}

/** 更新批量草稿的接种地点，并在清空或切回默认门诊时同步复位 pinAsDefault。 */
export function applyBatchClinicChange(
  draft: BatchDoseDraft,
  nextValue: string,
  defaultClinicName: string,
): BatchDoseDraft {
  return {
    ...draft,
    clinicName: nextValue,
    clinicAutoFilled: false,
    pinAsDefault: shouldResetClinicPin(nextValue, defaultClinicName) ? false : draft.pinAsDefault,
  };
}

/** 校验批量操作草稿并组装后端 BatchVaccineInput（留空省略 clinic_name / note 以保留各剂既有值）。 */
export function validateAndBuildBatchUpdate(
  draft: BatchDoseDraft,
  intent: BatchDrawerIntent,
  ctx: { readonly birthDate: string; readonly today: string },
):
  | { readonly ok: true; readonly input: BatchVaccineInput; readonly toastTitle: string }
  | { readonly ok: false; readonly error: string } {
  if (!draft.date) {
    return {
      ok: false,
      error: intent.action === 'schedule' ? '请选择预约日期' : '请选择实际接种日期',
    };
  }
  if (intent.action === 'complete') {
    const vacErr = validateVaccinatedAtBounds(draft.date, ctx.birthDate, ctx.today, '请选择实际接种日期');
    if (vacErr) {
      return { ok: false, error: vacErr };
    }
  }

  const trimmedClinic = draft.clinicName.trim();
  const trimmedNote = draft.note.trim();

  const input: BatchVaccineInput = {
    action: intent.action,
    dose_ids: [...intent.doseIds],
    ...(intent.action === 'schedule'
      ? { scheduled_date: draft.date, scheduled_time: draft.time.trim() || null }
      : { vaccinated_at: draft.date }),
    ...(trimmedClinic ? { clinic_name: trimmedClinic, set_default_clinic: draft.pinAsDefault } : {}),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };

  const toastTitle =
    intent.action === 'schedule'
      ? `已合并预约 ${intent.doseIds.length} 剂疫苗`
      : `已标记 ${intent.doseIds.length} 剂疫苗为已接种`;

  return { ok: true, input, toastTitle };
}

/** 根据出生日期推导产院疫苗默认接种日（卡介苗常规为出生次日，若今天即出生当天则钳位至出生当天）。 */
export function getDefaultBirthDoseDate(dose: VaccineDose, birthDate: string, today: string): string {
  if (dose.template_code !== 'bcg') {
    return birthDate;
  }
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return birthDate;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return nextKey <= today ? nextKey : birthDate;
}

/**
 * 串行确认产院疫苗前统一预校验全部勾选剂次日期，并构造逐剂更新载荷，
 * 避免第 1 剂落库后第 2 剂因越界报 400 导致半成功状态。
 */
export function validateAndBuildBirthConfirmRequests(
  items: readonly BirthConfirmItem[],
  birthDate: string,
  today: string,
):
  | {
      readonly ok: true;
      readonly requests: ReadonlyArray<{ readonly id: number; readonly input: UpdateVaccineDoseInput }>;
    }
  | { readonly ok: false; readonly error: string } {
  for (const { dose, vaccinatedAt } of items) {
    if (!vaccinatedAt) {
      return { ok: false, error: `请填写「${dose.short_name}」的实际接种日期` };
    }
    if (vaccinatedAt < birthDate || vaccinatedAt > today) {
      return { ok: false, error: `「${dose.short_name}」的接种日期需在出生日期至今天之间` };
    }
  }

  return {
    ok: true,
    requests: items.map(({ dose, vaccinatedAt }) => ({
      id: dose.id,
      input: {
        status: 'completed',
        planned_date: dose.planned_date,
        scheduled_date: null,
        scheduled_time: null,
        clinic_name: dose.clinic_name,
        vaccinated_at: vaccinatedAt,
        site: dose.site,
        manufacturer: dose.manufacturer,
        batch_no: dose.batch_no,
        reaction: dose.reaction,
        note: dose.note,
      },
    })),
  };
}
