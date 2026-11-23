import { useQuery } from '@tanstack/react-query';
import { RECORD_CATEGORY_META, type RecordCategoryMeta } from '@/lib/categories';
import { apiRequest } from '@/lib/http';
import { DASHBOARD_QUERY_KEY } from '@/lib/query-client';
import {
  type CareDailySummary,
  type FeedingDailySummary,
  getTemperatureSeverity,
  type SleepDailySummary,
} from '@/lib/records';
import { formatDurationMin, formatTimeSince, getBrowserTimeZone } from '@/lib/time';

export interface DashboardSummary {
  date: string;
  timezone: string;
  feeding: FeedingDailySummary & {
    last_feeding_at: string | null;
  };
  sleep: SleepDailySummary;
  health: {
    latest_temp_c: number | null;
    latest_temp_at: string | null;
  };
  care: CareDailySummary & {
    last_diaper_at: string | null;
  };
}

export interface DashboardTrends {
  days: number;
  timezone: string;
  daily: Array<{
    date: string;
    label: string;
    feeding_ml: number;
    direct_breast_min: number;
    direct_breast_count: number;
    sleep_hours: number;
  }>;
  slots: Array<{
    slot: string;
    count: number;
  }>;
}

export type DashboardTrendTab = 'feeding' | 'sleep';

export interface DashboardTrendView {
  readonly daily: DashboardTrends['daily'];
  readonly isDirectBreastMode: boolean;
  readonly hasCurrentTrendData: boolean;
  readonly dataKey: 'feeding_ml' | 'direct_breast_min' | 'sleep_hours';
  readonly description: string;
  readonly hasSlotData: boolean;
}

export interface DashboardKpiCard {
  readonly id: RecordCategoryMeta['id'];
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly iconClass: string;
  readonly icon: RecordCategoryMeta['icon'];
  readonly to: RecordCategoryMeta['url'];
  readonly alertTone: 'warning' | 'destructive' | null;
}

/**
 * 纯函数推导近 N 日趋势图的展示模式（纯亲喂分钟数 vs 奶量 ml vs 睡眠小时）与空态判定。
 */
export function selectTrendView(trends: DashboardTrends | undefined, tab: DashboardTrendTab): DashboardTrendView {
  const daily = trends?.daily ?? [];
  const hasBottleMilkTrend = daily.some((item) => item.feeding_ml > 0);
  const hasDirectBreastTrend = daily.some((item) => item.direct_breast_min > 0);
  const isDirectBreastMode = !hasBottleMilkTrend && hasDirectBreastTrend;
  const hasSleepTrend = daily.some((item) => item.sleep_hours > 0);
  const hasCurrentTrendData = tab === 'sleep' ? hasSleepTrend : hasBottleMilkTrend || hasDirectBreastTrend;
  const dataKey = tab === 'sleep' ? 'sleep_hours' : isDirectBreastMode ? 'direct_breast_min' : 'feeding_ml';
  const description =
    tab === 'sleep' ? '每日睡眠时长（小时）' : isDirectBreastMode ? '每日亲喂时长（分钟）' : '每日奶量（ml）';
  const hasSlotData = (trends?.slots ?? []).some((item) => item.count > 0);

  return {
    daily,
    isDirectBreastMode,
    hasCurrentTrendData,
    dataKey,
    description,
    hasSlotData,
  };
}

/**
 * 纯函数将今日汇总 KPI 转换为首页 4 张指标卡片的展示值、副标题与异常预警色调。
 */
export function buildDashboardKpiCards(summary: DashboardSummary | undefined, now: Date): DashboardKpiCard[] {
  const feedingValue = summary
    ? summary.feeding.total_ml > 0
      ? `${summary.feeding.total_ml} ml`
      : summary.feeding.direct_breast_count > 0
        ? `亲喂 ${summary.feeding.direct_breast_count} 次`
        : '0 ml'
    : '—';

  const feedingSub = summary
    ? summary.feeding.last_feeding_at
      ? `距上次 ${formatTimeSince(summary.feeding.last_feeding_at, now)} · 今日 ${summary.feeding.total_count} 次`
      : '今日还没有记录'
    : '今日喂养汇总';

  const sleepValue = summary ? formatDurationMin(summary.sleep.total_min) : '—';
  const sleepSub = summary
    ? `小睡 ${summary.sleep.nap_count} 次 · 夜觉 ${formatDurationMin(summary.sleep.night_min)}`
    : '今日睡眠汇总';

  const latestTemp = summary?.health.latest_temp_c ?? null;
  const tempSeverity = latestTemp !== null ? getTemperatureSeverity(latestTemp) : null;
  const healthValue = latestTemp !== null ? `${latestTemp.toFixed(1)} ℃` : '—';
  const healthSub = summary?.health.latest_temp_at
    ? `${tempSeverity?.label ?? ''} · ${formatTimeSince(summary.health.latest_temp_at, now)}`
    : '暂无体温记录';

  const careValue = summary ? `${summary.care.total_count} 次` : '—';
  const careSub = summary
    ? summary.care.last_diaper_at
      ? `嘘嘘 ${summary.care.pee_count} · 便便 ${summary.care.poop_count} · 上次 ${formatTimeSince(summary.care.last_diaper_at, now)}`
      : `嘘嘘 ${summary.care.pee_count} · 便便 ${summary.care.poop_count}`
    : '今日护理汇总';

  const feedingMeta = RECORD_CATEGORY_META.feeding;
  const sleepMeta = RECORD_CATEGORY_META.sleep;
  const healthMeta = RECORD_CATEGORY_META.health;
  const careMeta = RECORD_CATEGORY_META.care;

  return [
    {
      id: feedingMeta.id,
      label: '今日喂养',
      value: feedingValue,
      sub: feedingSub,
      iconClass: feedingMeta.softClass,
      icon: feedingMeta.icon,
      to: feedingMeta.url,
      alertTone: null,
    },
    {
      id: sleepMeta.id,
      label: '今日睡眠',
      value: sleepValue,
      sub: sleepSub,
      iconClass: sleepMeta.softClass,
      icon: sleepMeta.icon,
      to: sleepMeta.url,
      alertTone: null,
    },
    {
      id: healthMeta.id,
      label: '最近体温',
      value: healthValue,
      sub: healthSub,
      iconClass: healthMeta.softClass,
      icon: healthMeta.icon,
      to: healthMeta.url,
      alertTone: tempSeverity && tempSeverity.level !== 'normal' ? tempSeverity.level : null,
    },
    {
      id: careMeta.id,
      label: '今日护理',
      value: careValue,
      sub: careSub,
      iconClass: careMeta.softClass,
      icon: careMeta.icon,
      to: careMeta.url,
      alertTone: null,
    },
  ];
}

export async function fetchDashboardSummary(signal?: AbortSignal): Promise<DashboardSummary> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  return apiRequest<DashboardSummary>(`/api/dashboard/summary?tz=${tz}`, { signal });
}

export async function fetchDashboardTrends(days = 7, signal?: AbortSignal): Promise<DashboardTrends> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  return apiRequest<DashboardTrends>(`/api/dashboard/trends?days=${days}&tz=${tz}`, { signal });
}

export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: [...DASHBOARD_QUERY_KEY, 'summary'],
    queryFn: ({ signal }) => fetchDashboardSummary(signal),
    refetchInterval: 60_000,
  });
}

export function useDashboardTrendsQuery(days = 7) {
  return useQuery({
    queryKey: [...DASHBOARD_QUERY_KEY, 'trends', days],
    queryFn: ({ signal }) => fetchDashboardTrends(days, signal),
  });
}
