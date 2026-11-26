import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { resolveMutationBabyId, useActiveBabyId } from '@/lib/baby';
import type { RecordCategory } from '@/lib/categories';
import { ApiError, apiRequest } from '@/lib/http';
import { babyDashboardQueryKey, babyRecordDefaultsQueryKey, babyRecordsQueryKey } from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';

export type RecordRange = 'today' | '7d' | '30d' | 'all';

export type FeedingSubtype = 'breast' | 'formula' | 'solid';
export type FeedingMode = 'direct' | 'bottle';
export type BreastSide = 'left' | 'right' | 'both';
export type SolidAcceptance = 'like' | 'neutral' | 'dislike';

export interface FeedingRecord {
  id: number;
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
  subtype: SleepSubtype;
  started_at: string;
  ended_at: string;
  duration_min: number;
  note: string;
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
  subtype: CareSubtype;
  diaper_kind: DiaperKind | null;
  stool_consistency: StoolConsistency | null;
  stool_color: StoolColor | null;
  care_title: string | null;
  recorded_at: string;
  note: string;
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

type HealthSubtype = 'temperature' | 'medicine' | 'growth' | 'teeth';

export interface HealthRecord {
  id: number;
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

interface ListResult<T, S> {
  items: T[];
  total: number;
  has_more: boolean;
  daily_summaries: Record<string, S>;
}

export interface MedicinePreset {
  name: string;
  dosage: string;
}

export interface SolidFoodPreset {
  food: string;
  amount: string;
}

export interface SmartDefaults {
  feeding: {
    last_milk_ml: number;
    frequent_milk_ml: number[];
    last_feeding_subtype: FeedingSubtype;
    last_milk_subtype: 'formula' | 'breast';
    last_breast_mode: FeedingMode;
    last_breast_duration_min: number;
    last_breast_side: BreastSide | null;
    suggested_breast_side: BreastSide;
    recent_solids: SolidFoodPreset[];
  };
  sleep: {
    suggested_nap_min: number;
    suggested_night_min: number;
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

/** 喂养冷启动默认值（奶量 ml / 亲喂分钟）：供快记表单边界与首页一键直记共用，避免跨层反向依赖。 */
export const FEEDING_DEFAULTS = {
  milkML: 90,
  breastMin: 15,
} as const;

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

/** 单条记录的新增/编辑/删除会同时影响当前宝宝的分页列表、智能默认值与首页看板统计，统一失效三组查询缓存。 */
function invalidateAllRecordQueries(queryClient: QueryClient, babyId: number) {
  void queryClient.invalidateQueries({ queryKey: babyRecordsQueryKey(babyId) });
  void queryClient.invalidateQueries({ queryKey: babyRecordDefaultsQueryKey(babyId) });
  void queryClient.invalidateQueries({ queryKey: babyDashboardQueryKey(babyId) });
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

async function fetchRecordList<C extends RecordCategory>(
  babyId: number,
  category: C,
  params: ListParams,
  signal?: AbortSignal,
): Promise<ListResult<RecordOf<C>, DailySummaryOf<C>>> {
  return apiRequest<ListResult<RecordOf<C>, DailySummaryOf<C>>>(
    `/api/babies/${babyId}/records/${category}?${buildListQueryString(params)}`,
    { signal },
  );
}

async function fetchSmartDefaults(babyId: number, signal?: AbortSignal): Promise<SmartDefaults> {
  return apiRequest<SmartDefaults>(`/api/babies/${babyId}/records/defaults`, { signal });
}

async function saveRecord(babyId: number, req: SaveRecordRequest): Promise<RecordOf<RecordCategory>> {
  const path =
    req.id !== undefined
      ? `/api/babies/${babyId}/records/${req.category}/${req.id}`
      : `/api/babies/${babyId}/records/${req.category}`;
  const method = req.id !== undefined ? 'PUT' : 'POST';
  const res = await apiRequest<{ record: RecordOf<RecordCategory> }>(path, { method, body: req.payload });
  return res.record;
}

async function deleteRecord(babyId: number, category: RecordCategory, id: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/babies/${babyId}/records/${category}/${id}`, { method: 'DELETE' });
}

export function useSmartDefaultsQuery(enabled = true) {
  const activeBabyId = useActiveBabyId();
  return useQuery({
    queryKey: babyRecordDefaultsQueryKey(activeBabyId),
    queryFn: ({ signal }) => {
      if (activeBabyId === null) throw new ApiError(400, '请先选择宝宝档案。');
      return fetchSmartDefaults(activeBabyId, signal);
    },
    enabled: enabled && activeBabyId !== null,
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

/** 四类日常记录通用分页列表查询：基于 useInfiniteQuery 按 offset 递增拉取 PAGE_SIZE 条记录。 */
export function useRecordListQuery<C extends RecordCategory>(category: C, params: InfiniteListParams) {
  const activeBabyId = useActiveBabyId();
  return useInfiniteQuery({
    queryKey: [...babyRecordsQueryKey(activeBabyId), category, params],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      if (activeBabyId === null) throw new ApiError(400, '请先选择宝宝档案。');
      return fetchRecordList(activeBabyId, category, { ...params, limit: PAGE_SIZE, offset: pageParam }, signal);
    },
    getNextPageParam: (lastPage, allPages) => (lastPage.has_more ? allPages.length * PAGE_SIZE : undefined),
    enabled: activeBabyId !== null,
  });
}

const GROWTH_CHART_LIMIT = 100;

/** 生长曲线专用查询：一次拉取最多 100 条历史生长测量（对齐后端 MaxListLimit），避免受列表 20 条分页截断。 */
export function useGrowthChartQuery() {
  const activeBabyId = useActiveBabyId();
  return useQuery({
    queryKey: [...babyRecordsQueryKey(activeBabyId), 'health', 'growth-chart'],
    queryFn: ({ signal }) => {
      if (activeBabyId === null) throw new ApiError(400, '请先选择宝宝档案。');
      return fetchRecordList(
        activeBabyId,
        'health',
        { subtype: 'growth', range: 'all', limit: GROWTH_CHART_LIMIT, offset: 0 },
        signal,
      );
    },
    enabled: activeBabyId !== null,
  });
}

export function useSaveRecordMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async (req: SaveRecordRequest) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      const saved = await saveRecord(targetBabyId, req);
      invalidateAllRecordQueries(queryClient, targetBabyId);
      return saved;
    },
  });
}

export function useDeleteRecordMutation() {
  const queryClient = useQueryClient();
  const activeBabyId = useActiveBabyId();
  return useMutation({
    mutationFn: async ({ category, id }: { readonly category: RecordCategory; readonly id: number }) => {
      const targetBabyId = resolveMutationBabyId(activeBabyId);
      await deleteRecord(targetBabyId, category, id);
      invalidateAllRecordQueries(queryClient, targetBabyId);
    },
  });
}
