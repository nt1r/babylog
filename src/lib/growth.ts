import { dashboardSummaryQueryOptions, useBabyQuery } from '@/lib/baby-api';
import { formatShortCnDate, getLocalDateKeyFromISO } from '@/lib/time';

export interface GrowthSummary {
  latest_weight_kg: number | null;
  weight_recorded_at: string | null;
  weight_is_birth: boolean;
  latest_height_cm: number | null;
  height_recorded_at: string | null;
  height_is_birth: boolean;
  latest_head_cm: number | null;
  head_recorded_at: string | null;
  teeth_count: number;
  latest_tooth_note: string | null;
  latest_tooth_at: string | null;
}

interface GrowthSummaryEnvelope {
  date: string;
  growth: GrowthSummary;
}

interface GrowthSummaryView {
  readonly growth: GrowthSummary;
  readonly referenceDate: string;
}

interface GrowthMetricTile {
  readonly key: 'weight' | 'height' | 'head';
  readonly shortLabel: string;
  readonly fullLabel: string;
  readonly value: string;
  readonly isBirth: boolean;
  readonly compactDate: string;
  readonly detailDate: string;
}

/** 格式化生长概览指标的日期标注（兼容出生日期 YYYY-MM-DD 与记录 ISO 时间戳，复用统一短日期格式）。 */
export function formatGrowthMetricDate(raw: string | null, referenceDateStr?: string): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return formatShortCnDate(raw, referenceDateStr);
  }
  const dateKey = getLocalDateKeyFromISO(raw);
  return dateKey ? formatShortCnDate(dateKey, referenceDateStr) : '';
}

/** 统一构造体重/身高/头围三项展示模型，供首页「最新生长发育」卡与 `/growth` 概览卡共享。 */
export function buildGrowthMetricTiles(
  growth: GrowthSummary | undefined,
  referenceDateStr?: string,
): readonly GrowthMetricTile[] {
  const weightDate = growth?.weight_recorded_at
    ? formatGrowthMetricDate(growth.weight_recorded_at, referenceDateStr)
    : '';
  const heightDate = growth?.height_recorded_at
    ? formatGrowthMetricDate(growth.height_recorded_at, referenceDateStr)
    : '';
  const headDate = growth?.head_recorded_at ? formatGrowthMetricDate(growth.head_recorded_at, referenceDateStr) : '';

  return [
    {
      key: 'weight',
      shortLabel: '体重',
      fullLabel: '最新体重',
      value: growth?.latest_weight_kg != null ? `${growth.latest_weight_kg} kg` : '—',
      isBirth: Boolean(growth?.weight_is_birth),
      compactDate: weightDate || '未记录',
      detailDate: weightDate ? `${growth?.weight_is_birth ? '出生记录 · ' : ''}${weightDate}` : '暂未记录',
    },
    {
      key: 'height',
      shortLabel: '身高',
      fullLabel: '最新身高',
      value: growth?.latest_height_cm != null ? `${growth.latest_height_cm} cm` : '—',
      isBirth: Boolean(growth?.height_is_birth),
      compactDate: heightDate || '未记录',
      detailDate: heightDate ? `${growth?.height_is_birth ? '出生记录 · ' : ''}${heightDate}` : '暂未记录',
    },
    {
      key: 'head',
      shortLabel: '头围',
      fullLabel: '最新头围',
      value: growth?.latest_head_cm != null ? `${growth.latest_head_cm} cm` : '—',
      isBirth: false,
      compactDate: headDate || '未记录',
      detailDate: headDate || '暂未记录',
    },
  ];
}

/**
 * 统一格式化乳牙萌出副文案，供看板「最新生长发育」卡与 `/growth` 概览卡共享。
 * 后端对 `teeth` 记录强制校验 `tooth_note` 非空，因此存在出牙记录时 `latest_tooth_note` 必有值。
 */
export function formatTeethSummaryText(
  growth: GrowthSummary | undefined,
  referenceDateStr: string | undefined,
  emptyFallback: string,
  prefix = '',
): string {
  if (!growth?.latest_tooth_note) return emptyFallback;
  const datePart = growth.latest_tooth_at
    ? ` · ${formatGrowthMetricDate(growth.latest_tooth_at, referenceDateStr)}`
    : '';
  return `${prefix}${growth.latest_tooth_note}${datePart}`;
}

function selectGrowthSummaryView(data: GrowthSummaryEnvelope): GrowthSummaryView {
  return {
    growth: data.growth,
    referenceDate: data.date,
  };
}

/**
 * 非轮询生长概览查询：直接复用 dashboardSummaryQueryOptions 共享缓存键与请求路径，
 * 并通过 select 投影生长字段，避免 `/growth` 页面与录入抽屉触发 60 秒轮询。
 */
export function useGrowthSummaryQuery(enabled = true) {
  return useBabyQuery({
    ...dashboardSummaryQueryOptions<GrowthSummaryEnvelope>(),
    select: selectGrowthSummaryView,
    enabled,
    refetchInterval: false,
  });
}
