import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/http';
import { VACCINE_CATALOG_QUERY_KEY, VACCINES_QUERY_KEY } from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';

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
  kind: VaccineAlertState;
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

interface CreateCustomVaccineInput {
  vaccine_name: string;
  category: VaccineCategory;
  note: string;
  doses: DosePlanInput[];
}

interface UpdateVaccineDoseInput {
  status: VaccineStatus;
  age_months?: number;
  planned_date: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  clinic_name: string;
  vaccinated_at: string | null;
  site: string;
  manufacturer: string;
  batch_no: string;
  reaction: string;
  note: string;
}

interface BatchVaccineInput {
  action: 'schedule' | 'complete';
  dose_ids: number[];
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  vaccinated_at?: string | null;
  clinic_name?: string;
  note?: string;
}

export type VaccineStatusFilter = 'all' | 'attention' | 'scheduled' | 'pending' | 'completed';
export type VaccineCategoryFilter = 'all' | VaccineCategory;

export const VACCINE_SITE_PRESETS = ['左上臂', '右上臂', '左大腿前外侧', '右大腿前外侧', '口服'] as const;

export const VACCINE_REACTION_PRESETS = ['无异常', '针眼微红/轻微硬结', '低热（<38.5℃）', '轻度哭闹/嗜睡'] as const;

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

/** 格式化 YYYY-MM-DD 为易读中文短日期（跨年带年份，当年省去年份）。 */
export function formatShortCnDate(dateStr: string, referenceDateStr?: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const refYear = referenceDateStr ? Number(referenceDateStr.slice(0, 4)) : new Date().getFullYear();
  if (y === refYear) return `${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

/** 按筛选条件过滤剂次列表。 */
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

/** 构建以周一为起始的自然月日历网格及当月全部剂次列表。 */
export function buildVaccineCalendarMonth(
  year: number,
  monthIndex: number, // 0..11
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

// ===================== API & TanStack Query Hooks =====================

async function fetchVaccinesOverview(signal?: AbortSignal): Promise<VaccineOverviewResponse> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  return apiRequest<VaccineOverviewResponse>(`/api/vaccines?tz=${tz}`, { signal });
}

async function fetchVaccineCatalog(signal?: AbortSignal): Promise<VaccineCatalogResponse> {
  return apiRequest<VaccineCatalogResponse>('/api/vaccines/catalog', { signal });
}

export function useVaccinesOverviewQuery(enabled = true) {
  return useQuery({
    queryKey: VACCINES_QUERY_KEY,
    queryFn: ({ signal }) => fetchVaccinesOverview(signal),
    enabled,
  });
}

export function useVaccineCatalogQuery(enabled = true) {
  return useQuery({
    queryKey: VACCINE_CATALOG_QUERY_KEY,
    queryFn: ({ signal }) => fetchVaccineCatalog(signal),
    enabled,
  });
}

export function useAddVaccineTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { templateCode: string; doses?: DosePlanInput[] }) => {
      const tz = encodeURIComponent(getBrowserTimeZone());
      return apiRequest<{ doses: VaccineDose[] }>(`/api/vaccines/from-template?tz=${tz}`, {
        method: 'POST',
        body: {
          template_code: params.templateCode,
          doses: params.doses,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: VACCINE_CATALOG_QUERY_KEY });
    },
  });
}

export function useCreateCustomVaccineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCustomVaccineInput) => {
      const tz = encodeURIComponent(getBrowserTimeZone());
      return apiRequest<{ doses: VaccineDose[] }>(`/api/vaccines?tz=${tz}`, {
        method: 'POST',
        body: input,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
    },
  });
}

export function useUpdateVaccineDoseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: number; input: UpdateVaccineDoseInput }) => {
      const tz = encodeURIComponent(getBrowserTimeZone());
      return apiRequest<{ dose: VaccineDose }>(`/api/vaccines/${params.id}?tz=${tz}`, {
        method: 'PUT',
        body: params.input,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
    },
  });
}

export function useBatchVaccineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BatchVaccineInput) => {
      const tz = encodeURIComponent(getBrowserTimeZone());
      return apiRequest<{ doses: VaccineDose[] }>(`/api/vaccines/batch?tz=${tz}`, {
        method: 'POST',
        body: input,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
    },
  });
}

export function useDeleteVaccineDoseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      return apiRequest<{ deleted: boolean }>(`/api/vaccines/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: VACCINE_CATALOG_QUERY_KEY });
    },
  });
}

export function useDeleteVaccineTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateCode: string) => {
      return apiRequest<{ deleted: boolean }>(`/api/vaccines/template/${encodeURIComponent(templateCode)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: VACCINE_CATALOG_QUERY_KEY });
    },
  });
}
