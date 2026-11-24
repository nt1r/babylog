import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { RecordCategory } from '@/lib/categories';
import { apiRequest } from '@/lib/http';
import { DASHBOARD_QUERY_KEY, RECORD_DEFAULTS_QUERY_KEY, RECORDS_QUERY_KEY } from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';

export type RecordRange = 'today' | '7d' | '30d' | 'all';

export type FeedingSubtype = 'breast' | 'formula' | 'solid';
export type FeedingMode = 'direct' | 'bottle';
export type BreastSide = 'left' | 'right' | 'both';
export type SolidAcceptance = 'like' | 'neutral' | 'dislike';

export interface FeedingRecord {
  id: number;
  baby_id: number;
  subtype: FeedingSubtype;
  feeding_mode: FeedingMode | null;
  breast_side: BreastSide | null;
  amount_ml: number | null;
  duration_min: number | null;
  solid_food: string | null;
  solid_amount: string | null;
  acceptance: SolidAcceptance | null;
  recorded_at: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface FeedingInput {
  subtype: FeedingSubtype;
  feeding_mode?: FeedingMode | null;
  breast_side?: BreastSide | null;
  amount_ml?: number | null;
  duration_min?: number | null;
  solid_food?: string | null;
  solid_amount?: string | null;
  acceptance?: SolidAcceptance | null;
  recorded_at: string;
  note: string;
}

export interface FeedingDailySummary {
  total_ml: number;
  direct_breast_count: number;
  direct_breast_min: number;
  solid_count: number;
  total_count: number;
}

export type SleepSubtype = 'nap' | 'night';

export interface SleepRecord {
  id: number;
  baby_id: number;
  subtype: SleepSubtype;
  started_at: string;
  ended_at: string;
  duration_min: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface SleepInput {
  subtype: SleepSubtype;
  started_at: string;
  ended_at: string;
  note: string;
}

export interface SleepDailySummary {
  total_min: number;
  nap_count: number;
  night_min: number;
}

export type CareSubtype = 'diaper' | 'bath' | 'other';
export type DiaperKind = 'pee' | 'poop' | 'both';
export type StoolConsistency = 'watery' | 'soft' | 'formed' | 'hard';
export type StoolColor = 'yellow' | 'green' | 'brown' | 'abnormal';

export interface CareRecord {
  id: number;
  baby_id: number;
  subtype: CareSubtype;
  diaper_kind: DiaperKind | null;
  stool_consistency: StoolConsistency | null;
  stool_color: StoolColor | null;
  care_title: string | null;
  recorded_at: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface CareInput {
  subtype: CareSubtype;
  diaper_kind?: DiaperKind | null;
  stool_consistency?: StoolConsistency | null;
  stool_color?: StoolColor | null;
  care_title?: string | null;
  recorded_at: string;
  note: string;
}

export interface CareDailySummary {
  total_count: number;
  pee_count: number;
  poop_count: number;
  bath_count: number;
  other_count: number;
}

export type HealthSubtype = 'temperature' | 'medicine' | 'growth' | 'teeth';

export interface HealthRecord {
  id: number;
  baby_id: number;
  subtype: HealthSubtype;
  temperature_c: number | null;
  medicine_name: string | null;
  medicine_dosage: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  head_cm: number | null;
  tooth_note: string | null;
  recorded_at: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface HealthInput {
  subtype: HealthSubtype;
  temperature_c?: number | null;
  medicine_name?: string | null;
  medicine_dosage?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  head_cm?: number | null;
  tooth_note?: string | null;
  recorded_at: string;
  note: string;
}

export interface HealthDailySummary {
  total_count: number;
  medicine_count: number;
  growth_count: number;
  teeth_count: number;
  latest_temp_c: number | null;
}

interface RecordTypeMap {
  feeding: { record: FeedingRecord; input: FeedingInput; summary: FeedingDailySummary };
  sleep: { record: SleepRecord; input: SleepInput; summary: SleepDailySummary };
  care: { record: CareRecord; input: CareInput; summary: CareDailySummary };
  health: { record: HealthRecord; input: HealthInput; summary: HealthDailySummary };
}

export type RecordOf<C extends RecordCategory> = RecordTypeMap[C]['record'];
export type DailySummaryOf<C extends RecordCategory> = RecordTypeMap[C]['summary'];

export interface ListResult<T, S> {
  items: T[];
  total: number;
  has_more: boolean;
  daily_summaries: Record<string, S>;
}

export interface MedicinePreset {
  name: string;
  dosage: string;
}

export interface SmartDefaults {
  feeding: {
    last_milk_ml: number;
    frequent_milk_ml: number[];
    last_feeding_subtype: FeedingSubtype;
    last_breast_side: BreastSide | null;
    suggested_breast_side: BreastSide;
    recent_solid_foods: string[];
  };
  health: {
    last_temperature_c: number;
    recent_medicines: MedicinePreset[];
  };
  care: {
    recent_other_titles: string[];
  };
}

export type EditableRecord = {
  [C in RecordCategory]: { category: C; record: RecordOf<C> };
}[RecordCategory];

export type SaveRecordRequest =
  | { readonly category: 'feeding'; readonly id?: number; readonly payload: FeedingInput }
  | { readonly category: 'sleep'; readonly id?: number; readonly payload: SleepInput }
  | { readonly category: 'care'; readonly id?: number; readonly payload: CareInput }
  | { readonly category: 'health'; readonly id?: number; readonly payload: HealthInput };

/** 将泛型分类与对应记录打包为判别联合 EditableRecord，供通用列表页安全传给编辑/复制抽屉。 */
export function toEditableRecord<C extends RecordCategory>(category: C, record: RecordOf<C>): EditableRecord {
  return { category, record } as EditableRecord;
}

export const BREAST_SIDE_LABELS: Record<BreastSide, string> = {
  left: '左侧',
  right: '右侧',
  both: '双侧',
};

export const ACCEPTANCE_LABELS: Record<SolidAcceptance, string> = {
  like: '爱吃',
  neutral: '一般',
  dislike: '抗拒',
};

export const DIAPER_KIND_LABELS: Record<DiaperKind, string> = {
  pee: '嘘嘘',
  poop: '便便',
  both: '嘘嘘 + 便便',
};

export const STOOL_CONSISTENCY_LABELS: Record<StoolConsistency, string> = {
  watery: '稀水',
  soft: '软便',
  formed: '成型',
  hard: '偏干',
};

export const STOOL_COLOR_LABELS: Record<StoolColor, string> = {
  yellow: '黄色',
  green: '绿色',
  brown: '棕色',
  abnormal: '异常色',
};

export const RANGE_LABELS: Record<RecordRange, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
  all: '全部',
};

/** 判定体温分级，驱动设计系统语义色。 */
export function getTemperatureSeverity(temp: number): {
  level: 'normal' | 'warning' | 'destructive';
  label: string;
} {
  if (temp >= 38.5) return { level: 'destructive', label: '高热注意' };
  if (temp >= 37.3) return { level: 'warning', label: '偏高留意' };
  return { level: 'normal', label: '体温正常' };
}

/** 单条记录的新增/编辑/删除会同时影响分页列表、智能默认值与首页看板统计，统一失效三组查询缓存。 */
function invalidateAllRecordQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: RECORD_DEFAULTS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
}

interface ListParams {
  subtype?: string;
  range?: RecordRange;
  limit?: number;
  offset?: number;
}

function buildListQueryString(params: ListParams): string {
  const q = new URLSearchParams();
  q.set('tz', getBrowserTimeZone());
  if (params.subtype && params.subtype !== 'all') q.set('subtype', params.subtype);
  if (params.range) q.set('range', params.range);
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));
  return q.toString();
}

export async function fetchRecordList<C extends RecordCategory>(
  category: C,
  params: ListParams,
  signal?: AbortSignal,
): Promise<ListResult<RecordOf<C>, DailySummaryOf<C>>> {
  return apiRequest<ListResult<RecordOf<C>, DailySummaryOf<C>>>(
    `/api/records/${category}?${buildListQueryString(params)}`,
    { signal },
  );
}

export async function fetchSmartDefaults(signal?: AbortSignal): Promise<SmartDefaults> {
  return apiRequest<SmartDefaults>('/api/records/defaults', { signal });
}

export async function saveRecord(req: SaveRecordRequest): Promise<RecordOf<RecordCategory>> {
  const path = req.id !== undefined ? `/api/records/${req.category}/${req.id}` : `/api/records/${req.category}`;
  const method = req.id !== undefined ? 'PUT' : 'POST';
  const res = await apiRequest<{ record: RecordOf<RecordCategory> }>(path, { method, body: req.payload });
  return res.record;
}

export async function deleteRecord(category: RecordCategory, id: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/records/${category}/${id}`, { method: 'DELETE' });
}

export function useSmartDefaultsQuery(enabled = true) {
  return useQuery({
    queryKey: RECORD_DEFAULTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchSmartDefaults(signal),
    enabled,
  });
}

const PAGE_SIZE = 20;

interface InfiniteListParams {
  subtype?: string;
  range?: RecordRange;
}

/** 合并分页列表的所有页数据：按 ID 去重记录并汇总各本地自然日的完整小计。 */
export function flattenInfiniteList<T extends { id: number }, S>(
  data: InfiniteData<ListResult<T, S>> | undefined,
): { items: T[]; total: number; dailySummaries: Record<string, S> } {
  if (!data) {
    return { items: [], total: 0, dailySummaries: {} };
  }
  const seen = new Set<number>();
  const items: T[] = [];
  const dailySummaries: Record<string, S> = {};
  let total = 0;

  for (const page of data.pages) {
    total = page.total;
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    Object.assign(dailySummaries, page.daily_summaries);
  }
  return { items, total, dailySummaries };
}

export function useRecordListQuery<C extends RecordCategory>(category: C, params: InfiniteListParams) {
  return useInfiniteQuery({
    queryKey: [...RECORDS_QUERY_KEY, category, params],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchRecordList(category, { ...params, limit: PAGE_SIZE, offset: pageParam }, signal),
    getNextPageParam: (lastPage, allPages) => (lastPage.has_more ? allPages.length * PAGE_SIZE : undefined),
  });
}

export function useSaveRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: SaveRecordRequest) => saveRecord(req),
    onSuccess: () => invalidateAllRecordQueries(queryClient),
  });
}

export function useDeleteRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ category, id }: { readonly category: RecordCategory; readonly id: number }) =>
      deleteRecord(category, id),
    onSuccess: () => invalidateAllRecordQueries(queryClient),
  });
}
