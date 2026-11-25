import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resolveMutationBabyId, useActiveBabyId } from '@/lib/baby';
import { ApiError, apiRequest } from '@/lib/http';
import type { exportVaccineVisitIcs } from '@/lib/ics';
import { babiesQueryKey, babyVaccineCatalogQueryKey, babyVaccinesQueryKey } from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';
import { useAuthStore } from '@/stores/auth';

export type VaccineCategory = 'nip' | 'optional';
export type VaccineStatus = 'pending' | 'scheduled' | 'completed';
type VaccineAlertState =
  | 'completed'
  | 'scheduled'
  | 'scheduled_soon'
  | 'scheduled_overdue'
  | 'upcoming'
  | 'due_soon'
  | 'overdue';

export interface VaccineDose {
  id: number;
  template_code: string | null;
  dose_number: number;
  total_doses: number;
  vaccine_name: string;
  category: VaccineCategory;
  age_months: number;
  age_label: string;
  planned_date: string | null;
  status: VaccineStatus;
  scheduled_date: string | null;
  scheduled_time: string | null;
  clinic_name: string;
  vaccinated_at: string | null;
  site: string;
  manufacturer: string;
  batch_no: string;
  reaction: string;
  note: string;
  short_name: string;
  default_due_date: string;
  effective_date: string;
  alert_state: VaccineAlertState;
  days_until: number;
  deletable: boolean;
  prevents: string;
  route: string;
  dose_tip: string;
  precautions_before: string[];
  precautions_after: string[];
  risk_warning: string;
}

export interface VaccineNextFocus {
  kind: Exclude<VaccineAlertState, 'completed'>;
  target_date: string;
  days_until: number;
  age_label: string;
  clinic_name: string;
  scheduled_time: string;
  dose_ids: number[];
}

interface VaccineSummary {
  scheduled_count: number;
  nip_total: number;
  nip_completed: number;
  optional_total: number;
  optional_completed: number;
  overdue_count: number;
  due_soon_count: number;
  scheduled_soon_count: number;
  scheduled_overdue_count: number;
  birth_confirm_pending: boolean;
  birth_pending_dose_ids: number[];
  next_focus: VaccineNextFocus | null;
}

export interface VaccineOverviewResponse {
  today: string;
  birth_date: string;
  disclaimer: string;
  default_clinic_name: string;
  summary: VaccineSummary;
  recent_clinics: string[];
  doses: VaccineDose[];
}

interface CatalogDoseItem {
  dose_number: number;
  age_months: number;
  age_label: string;
  dose_tip: string;
}

export interface VaccineCatalogItem {
  code: string;
  name: string;
  prevents: string;
  route: string;
  risk_warning: string;
  dose_count: number;
  added: boolean;
  added_dose_count: number;
  doses: CatalogDoseItem[];
}

interface VaccineCatalogResponse {
  disclaimer: string;
  templates: VaccineCatalogItem[];
}

export interface DosePlanInput {
  age_months: number;
  planned_date: string | null;
}

export interface AddVaccineTemplateInput {
  templateCode: string;
  doses?: DosePlanInput[];
}

export interface CreateCustomVaccineInput {
  vaccine_name: string;
  category: VaccineCategory;
  note: string;
  doses: DosePlanInput[];
}

export interface UpdateVaccineDoseInput {
  status: VaccineStatus;
  age_months?: number;
  planned_date: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  clinic_name: string;
  set_default_clinic?: boolean;
  vaccinated_at: string | null;
  site: string;
  manufacturer: string;
  batch_no: string;
  reaction: string;
  note: string;
}

export interface BatchVaccineInput {
  action: 'schedule' | 'complete';
  dose_ids: number[];
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  vaccinated_at?: string | null;
  clinic_name?: string;
  set_default_clinic?: boolean;
  note?: string;
}

export type VaccineStatusFilter = 'all' | 'attention' | 'scheduled' | 'pending' | 'completed';
export type VaccineCategoryFilter = 'all' | VaccineCategory;

/** 疫苗总览查询的 5 分钟缓存窗口，避免侧栏角标与首页看板切换时重复拉取。 */
export const VACCINE_OVERVIEW_STALE_MS = 5 * 60_000;

/**
 * 计算疫苗导航角标待关注数量与紧急程度：
 * 产院出生疫苗待确认与逾期/临期统计可能重叠，取两者较大值避免同一剂重复累加。
 */
export function computeVaccineAttentionBadge(summary: VaccineSummary | undefined): {
  readonly count: number;
  readonly urgent: boolean;
} {
  if (!summary) {
    return { count: 0, urgent: false };
  }
  const overdueTotal = summary.overdue_count + summary.scheduled_overdue_count;
  const dueSoonTotal = summary.due_soon_count + summary.scheduled_soon_count;
  const baseCount = overdueTotal + dueSoonTotal;
  const count = summary.birth_confirm_pending ? Math.max(summary.birth_pending_dose_ids.length, baseCount) : baseCount;
  return { count, urgent: overdueTotal > 0 };
}

export const VACCINE_SITE_PRESETS = ['左上臂', '右上臂', '左大腿前外侧', '右大腿前外侧', '口服'] as const;

export const VACCINE_REACTION_PRESETS = ['无异常', '针眼微红/轻微硬结', '低热（<38.5℃）', '轻度哭闹/嗜睡'] as const;

const OPPOSITE_INJECTION_SITE: Readonly<Record<string, string>> = {
  左上臂: '右上臂',
  右上臂: '左上臂',
  左大腿前外侧: '右大腿前外侧',
  右大腿前外侧: '左大腿前外侧',
};

/** 解析首选预填接种地点：优先使用固定的常去接种门诊，其次回落至最近一次使用的门诊。 */
export function resolvePreferredClinic(defaultClinicName: string, recentClinics: readonly string[]): string {
  const pinned = defaultClinicName.trim();
  if (pinned) return pinned;
  return recentClinics[0]?.trim() ?? '';
}

/** 合并常去门诊与历史最近门诊（默认门诊置顶且去重），供快捷胶囊渲染。 */
export function buildClinicSuggestions(defaultClinicName: string, recentClinics: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const pinned = defaultClinicName.trim();
  if (pinned) {
    seen.add(pinned);
    result.push(pinned);
  }
  for (const clinic of recentClinics) {
    const trimmed = clinic.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** 从同种疫苗历史已接种剂次中提取曾用品牌/厂家（按最近接种优先去重，最多 3 个），减少多剂次重复录入。 */
export function getSuggestedManufacturers(
  dose: Pick<VaccineDose, 'id' | 'template_code' | 'vaccine_name'>,
  allDoses: readonly VaccineDose[],
): string[] {
  const siblings = allDoses
    .filter((d) => {
      if (d.id === dose.id || !d.manufacturer.trim()) return false;
      if (dose.template_code) {
        return d.template_code === dose.template_code;
      }
      return d.template_code === null && d.vaccine_name === dose.vaccine_name;
    })
    .sort((a, b) => (b.vaccinated_at ?? '').localeCompare(a.vaccinated_at ?? '') || b.id - a.id);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of siblings) {
    const maker = item.manufacturer.trim();
    if (!maker || seen.has(maker)) continue;
    seen.add(maker);
    out.push(maker);
    if (out.length >= 3) break;
  }
  return out;
}

/** 检查同日是否已有其他已接种剂次记录了注射部位，并推导建议的左右交替部位。 */
export function getSameDaySiteSuggestion(
  doseId: number,
  vaccinatedAt: string,
  allDoses: readonly VaccineDose[],
): { usedSites: string[]; recommendedSite: string | null } {
  if (!vaccinatedAt) {
    return { usedSites: [], recommendedSite: null };
  }
  const sameDayDoses = allDoses
    .filter((d) => d.id !== doseId && d.status === 'completed' && d.vaccinated_at === vaccinatedAt && d.site.trim())
    .sort((a, b) => b.id - a.id);

  const usedSites: string[] = [];
  const seen = new Set<string>();
  for (const d of sameDayDoses) {
    const site = d.site.trim();
    if (!seen.has(site)) {
      seen.add(site);
      usedSites.push(site);
    }
  }

  let recommendedSite: string | null = null;
  for (const site of usedSites) {
    const opposite = OPPOSITE_INJECTION_SITE[site];
    if (opposite && !seen.has(opposite)) {
      recommendedSite = opposite;
      break;
    }
  }

  return { usedSites, recommendedSite };
}

interface AlertBadgeMeta {
  readonly label: string;
  readonly variant: 'success' | 'info' | 'warning' | 'destructive' | 'secondary';
  readonly dotClass: string;
  readonly pillClass: string;
}

/** 判断某派生提醒状态是否属于近期或逾期等需要家长优先关注的紧急态。 */
function isAttentionAlertState(alertState: VaccineAlertState): boolean {
  return (
    alertState === 'overdue' ||
    alertState === 'due_soon' ||
    alertState === 'scheduled_soon' ||
    alertState === 'scheduled_overdue'
  );
}

/** 将派生提醒状态映射为面向家长的中文标签与语义色板（已接种用柔绿、已预约用信息蓝，拉大视觉色差）。 */
export function getAlertBadgeMeta(alertState: VaccineAlertState): AlertBadgeMeta {
  switch (alertState) {
    case 'completed':
      return {
        label: '已接种',
        variant: 'success',
        dotClass: 'bg-success',
        pillClass: 'bg-success-soft/80 text-success-soft-foreground',
      };
    case 'scheduled_overdue':
      return {
        label: '预约已过',
        variant: 'destructive',
        dotClass: 'bg-destructive',
        pillClass: 'bg-destructive-soft/85 text-destructive-soft-foreground',
      };
    case 'scheduled_soon':
      return {
        label: '即将接种',
        variant: 'info',
        dotClass: 'bg-info',
        pillClass: 'bg-info-soft text-info-soft-foreground',
      };
    case 'scheduled':
      return {
        label: '已预约',
        variant: 'info',
        dotClass: 'bg-info',
        pillClass: 'bg-info-soft text-info-soft-foreground',
      };
    case 'overdue':
      return {
        label: '待补种/补录',
        variant: 'destructive',
        dotClass: 'bg-destructive',
        pillClass: 'bg-destructive-soft/85 text-destructive-soft-foreground',
      };
    case 'due_soon':
      return {
        label: '近期可接种',
        variant: 'warning',
        dotClass: 'bg-warning',
        pillClass: 'bg-warning-soft/85 text-warning-soft-foreground',
      };
    default:
      return {
        label: '未到龄',
        variant: 'secondary',
        dotClass: 'bg-muted-foreground/50',
        pillClass: 'bg-muted/75 text-muted-foreground',
      };
  }
}

/** 格式化距目标日期的天数倒计时文案。 */
export function formatDaysUntilLabel(daysUntil: number, status: VaccineStatus): string {
  if (status === 'completed') return '已完成';
  if (daysUntil === 0) return '就在今天';
  if (daysUntil === 1) return '明天';
  if (daysUntil > 1) return `还有 ${daysUntil} 天`;
  const past = Math.abs(daysUntil);
  if (status === 'scheduled') return `预约已过 ${past} 天`;
  return `已过预计日 ${past} 天`;
}

/** 格式化剂次序号文案：单剂疫苗返回「单剂全程」，多剂疫苗返回「第 X / Y 剂」。 */
export function formatDoseOrderLabel(dose: Pick<VaccineDose, 'dose_number' | 'total_doses'>): string {
  if (dose.total_doses <= 1) return '单剂全程';
  return `第 ${dose.dose_number} / ${dose.total_doses} 剂`;
}

/** 格式化紧凑疫苗短标题（多剂附加「第N剂」，单剂仅返回简称）。 */
export function formatDoseShortTitle(dose: Pick<VaccineDose, 'short_name' | 'dose_number' | 'total_doses'>): string {
  return dose.total_doses > 1 ? `${dose.short_name} 第${dose.dose_number}剂` : dose.short_name;
}

/** 按状态与分类筛选疫苗剂次（其中 attention 聚合四类紧急/临期提醒态）。 */
export function filterVaccineDoses(
  doses: readonly VaccineDose[],
  statusFilter: VaccineStatusFilter,
  categoryFilter: VaccineCategoryFilter,
): VaccineDose[] {
  return doses.filter((dose) => {
    if (categoryFilter !== 'all' && dose.category !== categoryFilter) {
      return false;
    }
    switch (statusFilter) {
      case 'attention':
        return isAttentionAlertState(dose.alert_state);
      case 'scheduled':
        return dose.status === 'scheduled';
      case 'pending':
        return dose.status === 'pending';
      case 'completed':
        return dose.status === 'completed';
      default:
        return true;
    }
  });
}

interface AgeStageGroup {
  readonly ageMonths: number;
  readonly ageLabel: string;
  readonly doses: VaccineDose[];
  readonly completedCount: number;
  readonly totalCount: number;
  readonly allCompleted: boolean;
  readonly hasAttention: boolean;
  readonly pendingDoseIds: number[];
  readonly earliestDate: string;
}

/** 将剂次按适龄月龄分组（升序）；批量默认日期仅从未完成剂次计算，避免被历史已完成接种日污染。 */
export function groupDosesByAgeStage(doses: readonly VaccineDose[]): AgeStageGroup[] {
  const map = new Map<number, VaccineDose[]>();
  for (const dose of doses) {
    const bucket = map.get(dose.age_months);
    if (bucket) {
      bucket.push(dose);
    } else {
      map.set(dose.age_months, [dose]);
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ageMonths, items]) => {
      const completedCount = items.filter((d) => d.status === 'completed').length;
      const pendingItems = items.filter((d) => d.status !== 'completed');
      const pendingDoseIds = pendingItems.map((d) => d.id);
      const hasAttention = items.some((d) => isAttentionAlertState(d.alert_state));

      const datePool = pendingItems.length > 0 ? pendingItems : items;
      let earliestDate = datePool[0]?.effective_date ?? '';
      for (const item of datePool) {
        if (item.effective_date < earliestDate) {
          earliestDate = item.effective_date;
        }
      }

      // 若该组所有剂次共享同一后端 age_label（例如「6月龄起」），优先保留；多标签混合时回落至标准月龄文案。
      const distinctLabels = new Set(items.map((d) => d.age_label).filter(Boolean));
      const fallbackLabel =
        ageMonths <= 0
          ? '出生时'
          : ageMonths >= 24 && ageMonths % 12 === 0
            ? `${ageMonths / 12}周岁`
            : `${ageMonths}月龄`;
      const ageLabel = distinctLabels.size === 1 ? (items[0]?.age_label ?? fallbackLabel) : fallbackLabel;

      return {
        ageMonths,
        ageLabel,
        doses: items,
        completedCount,
        totalCount: items.length,
        allCompleted: completedCount === items.length && items.length > 0,
        hasAttention,
        pendingDoseIds,
        earliestDate,
      };
    });
}

interface CalendarCell {
  readonly dateKey: string;
  readonly day: number;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly doses: VaccineDose[];
}

/** 构建以周一为起始的自然月日历网格及当月全部剂次列表（monthIndex 取值 0–11，对应 1–12 月）。 */
export function buildVaccineCalendarMonth(
  year: number,
  monthIndex: number,
  doses: readonly VaccineDose[],
  todayKey: string,
): { cells: CalendarCell[]; monthDoses: VaccineDose[] } {
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const dosesByDate = new Map<string, VaccineDose[]>();
  const monthDoses: VaccineDose[] = [];

  for (const dose of doses) {
    const list = dosesByDate.get(dose.effective_date);
    if (list) {
      list.push(dose);
    } else {
      dosesByDate.set(dose.effective_date, [dose]);
    }
    if (dose.effective_date.startsWith(monthPrefix)) {
      monthDoses.push(dose);
    }
  }
  monthDoses.sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.id - b.id);

  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  // 转为周一起始偏移：周一=0 .. 周日=6
  const startOffset = (firstDay.getUTCDay() + 6) % 7;
  const totalSlots = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalSlots; i++) {
    const dt = new Date(Date.UTC(year, monthIndex, 1 - startOffset + i));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const d = dt.getUTCDate();
    const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dateKey,
      day: d,
      inCurrentMonth: y === year && m === monthIndex,
      isToday: dateKey === todayKey,
      doses: dosesByDate.get(dateKey) ?? [],
    });
  }

  return { cells, monthDoses };
}

interface CalendarExportTarget {
  readonly date: string;
  readonly doses: readonly VaccineDose[];
  readonly isFallbackFocus: boolean;
}

/**
 * 解析接种日历「导出日历 (.ics)」对应的目标日期与未完成剂次：
 * 1. 已显式点选某日 → 仅导出当天未完成剂次（当天无可导出项则返回 null 禁用按钮，避免静默跨月导出）；
 * 2. 未点选具体日期 → 优先导出当月最早一天的未完成剂次；当月全空时回退至下一次接种焦点并标记 isFallbackFocus。
 */
export function resolveCalendarExportTarget(params: {
  readonly selectedDateKey: string | null;
  readonly selectedDayDoses: readonly VaccineDose[];
  readonly monthDoses: readonly VaccineDose[];
  readonly nextFocus: VaccineNextFocus | null;
  readonly allDoses: readonly VaccineDose[];
}): CalendarExportTarget | null {
  if (params.selectedDateKey) {
    const pendingOnSelected = params.selectedDayDoses.filter((d) => d.status !== 'completed');
    if (pendingOnSelected.length > 0) {
      return { date: params.selectedDateKey, doses: pendingOnSelected, isFallbackFocus: false };
    }
    return null;
  }

  const pendingInMonth = params.monthDoses.filter((d) => d.status !== 'completed');
  if (pendingInMonth.length > 0) {
    const firstDate = pendingInMonth[0].effective_date;
    return {
      date: firstDate,
      doses: pendingInMonth.filter((d) => d.effective_date === firstDate),
      isFallbackFocus: false,
    };
  }

  if (params.nextFocus) {
    const focusDoses = params.allDoses.filter((d) => params.nextFocus?.dose_ids.includes(d.id));
    if (focusDoses.length > 0) {
      return { date: params.nextFocus.target_date, doses: focusDoses, isFallbackFocus: true };
    }
  }
  return null;
}

/** 将已解析的日历导出目标组装为 exportVaccineVisitIcs 所需的导出选项。 */
export function buildCalendarIcsOptions(
  target: CalendarExportTarget,
  defaultClinicName: string,
  babyNickname?: string,
): Parameters<typeof exportVaccineVisitIcs>[0] {
  const lead = target.doses[0];
  const scheduledTime = target.doses.find((d) => d.status === 'scheduled' && d.scheduled_time)?.scheduled_time;
  const clinicName = target.doses.find((d) => d.clinic_name)?.clinic_name || defaultClinicName.trim();

  return {
    uidSeed: `cal-${target.date}-${target.doses.map((d) => d.id).join('-')}`,
    babyNickname,
    date: target.date,
    time: scheduledTime || undefined,
    location: clinicName || undefined,
    stageLabel: lead?.age_label,
    doses: target.doses,
  };
}

// --- API 请求与 TanStack Query Hooks ---

async function fetchVaccinesOverview(babyId: number, signal?: AbortSignal): Promise<VaccineOverviewResponse> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  return apiRequest<VaccineOverviewResponse>(`/api/babies/${babyId}/vaccines?tz=${tz}`, { signal });
}

async function fetchVaccineCatalog(babyId: number, signal?: AbortSignal): Promise<VaccineCatalogResponse> {
  return apiRequest<VaccineCatalogResponse>(`/api/babies/${babyId}/vaccines/catalog`, { signal });
}

export function useVaccinesOverviewQuery(enabled = true, staleTime?: number) {
  const activeBabyId = useActiveBabyId();
  return useQuery({
    queryKey: babyVaccinesQueryKey(activeBabyId),
    queryFn: ({ signal }) => {
      if (activeBabyId === null) throw new ApiError(400, '请先选择宝宝档案。');
      return fetchVaccinesOverview(activeBabyId, signal);
    },
    enabled: enabled && activeBabyId !== null,
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}

export function useVaccineCatalogQuery(enabled = true) {
  const activeBabyId = useActiveBabyId();
  return useQuery({
    queryKey: babyVaccineCatalogQueryKey(activeBabyId),
    queryFn: ({ signal }) => {
      if (activeBabyId === null) throw new ApiError(400, '请先选择宝宝档案。');
      return fetchVaccineCatalog(activeBabyId, signal);
    },
    enabled: enabled && activeBabyId !== null,
  });
}

export function useAddVaccineTemplateMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (params: AddVaccineTemplateInput) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const tz = encodeURIComponent(getBrowserTimeZone());
      const res = await apiRequest<{ doses: VaccineDose[] }>(
        `/api/babies/${targetBabyId}/vaccines/from-template?tz=${tz}`,
        {
          method: 'POST',
          body: {
            template_code: params.templateCode,
            doses: params.doses,
          },
        },
      );
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      void queryClient.invalidateQueries({ queryKey: babyVaccineCatalogQueryKey(targetBabyId) });
      return res;
    },
  });
}

export function useCreateCustomVaccineMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (input: CreateCustomVaccineInput) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const tz = encodeURIComponent(getBrowserTimeZone());
      const res = await apiRequest<{ doses: VaccineDose[] }>(`/api/babies/${targetBabyId}/vaccines?tz=${tz}`, {
        method: 'POST',
        body: input,
      });
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      return res;
    },
  });
}

export function useUpdateVaccineDoseMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (params: { id: number; input: UpdateVaccineDoseInput }) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const tz = encodeURIComponent(getBrowserTimeZone());
      const res = await apiRequest<{ dose: VaccineDose }>(
        `/api/babies/${targetBabyId}/vaccines/${params.id}?tz=${tz}`,
        {
          method: 'PUT',
          body: params.input,
        },
      );
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      const userId = useAuthStore.getState().user?.id ?? null;
      if (userId !== null) {
        void queryClient.invalidateQueries({ queryKey: babiesQueryKey(userId) });
      }
      return res;
    },
  });
}

export function useBatchVaccineMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (input: BatchVaccineInput) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const tz = encodeURIComponent(getBrowserTimeZone());
      const res = await apiRequest<{ doses: VaccineDose[] }>(`/api/babies/${targetBabyId}/vaccines/batch?tz=${tz}`, {
        method: 'POST',
        body: input,
      });
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      const userId = useAuthStore.getState().user?.id ?? null;
      if (userId !== null) {
        void queryClient.invalidateQueries({ queryKey: babiesQueryKey(userId) });
      }
      return res;
    },
  });
}

export function useUpdateDefaultClinicMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (clinicName: string) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const res = await apiRequest<{ default_clinic_name: string }>(
        `/api/babies/${targetBabyId}/vaccines/default-clinic`,
        {
          method: 'PUT',
          body: { clinic_name: clinicName },
        },
      );
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      const userId = useAuthStore.getState().user?.id ?? null;
      if (userId !== null) {
        void queryClient.invalidateQueries({ queryKey: babiesQueryKey(userId) });
      }
      return res;
    },
  });
}

export function useDeleteVaccineDoseMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (id: number) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const res = await apiRequest<{ deleted: boolean }>(`/api/babies/${targetBabyId}/vaccines/${id}`, {
        method: 'DELETE',
      });
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      void queryClient.invalidateQueries({ queryKey: babyVaccineCatalogQueryKey(targetBabyId) });
      return res;
    },
  });
}

export function useDeleteVaccineTemplateMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (templateCode: string) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const res = await apiRequest<{ deleted: boolean }>(
        `/api/babies/${targetBabyId}/vaccines/template/${encodeURIComponent(templateCode)}`,
        {
          method: 'DELETE',
        },
      );
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(targetBabyId) });
      void queryClient.invalidateQueries({ queryKey: babyVaccineCatalogQueryKey(targetBabyId) });
      return res;
    },
  });
}
