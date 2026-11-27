import type { BabyProfile } from '@/lib/baby';
import type { ChartExportLegendItem } from '@/lib/chart-export';
import type { DashboardTrends } from '@/lib/dashboard';
import { STOOL_COLOR_LABELS, STOOL_CONSISTENCY_LABELS } from '@/lib/records';
import { formatBabyAge, formatDurationMin } from '@/lib/time';

export type InsightRangeDays = 7 | 14 | 30 | 90;
export type FeedingChartTab = 'milk' | 'direct' | 'counts';

export const INSIGHT_RANGE_OPTIONS: ReadonlyArray<{ readonly value: `${InsightRangeDays}`; readonly label: string }> = [
  { value: '7', label: '近 7 天' },
  { value: '14', label: '近 14 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
];

type SeriesChartConfig = Record<string, { readonly label: string; readonly color: string }>;

interface ChartSeriesItem {
  readonly key: string;
  readonly label: string;
  readonly colorVar: `--${string}`;
  readonly exportLabel?: string;
  readonly swatchClass?: string;
  readonly swatchStyle?: 'box' | 'dot' | 'dashed';
  readonly referenceOnly?: boolean;
}

interface ChartSeriesBundle {
  readonly config: SeriesChartConfig;
  readonly exportLegend: readonly ChartExportLegendItem[];
  readonly items: readonly ChartSeriesItem[];
}

// 从单一声明同时派生 Recharts ChartConfig、高清图片导出 legend 与图例项，消除系列元数据多处重复定义。
function defineChartSeries(items: readonly ChartSeriesItem[]): ChartSeriesBundle {
  const config: SeriesChartConfig = {};
  for (const item of items) {
    if (!item.referenceOnly) {
      config[item.key] = { label: item.label, color: `var(${item.colorVar})` };
    }
  }
  const exportLegend: ChartExportLegendItem[] = items.map((item) => ({
    label: item.exportLabel ?? item.label,
    colorVar: item.colorVar,
  }));
  return { config, exportLegend, items };
}

/** 统计分析页全部图表的单一事实来源系列声明。 */
export const INSIGHTS_CHART_SERIES = {
  feedingMilk: defineChartSeries([
    {
      key: 'formula_ml',
      label: '配方奶',
      exportLabel: '配方奶 (ml)',
      colorVar: '--feeding',
      swatchClass: 'bg-feeding',
    },
    {
      key: 'bottle_breast_ml',
      label: '瓶喂母乳',
      exportLabel: '瓶喂母乳 (ml)',
      colorVar: '--primary',
      swatchClass: 'bg-primary',
    },
  ]),
  feedingDirect: defineChartSeries([
    {
      key: 'direct_breast_min',
      label: '亲喂时长',
      exportLabel: '亲喂时长 (分钟)',
      colorVar: '--feeding',
      swatchClass: 'bg-feeding',
    },
  ]),
  feedingCounts: defineChartSeries([
    { key: 'formula_count', label: '配方奶', colorVar: '--feeding', swatchClass: 'bg-feeding' },
    { key: 'bottle_breast_count', label: '瓶喂母乳', colorVar: '--primary', swatchClass: 'bg-primary' },
    { key: 'direct_breast_count', label: '亲喂', colorVar: '--health', swatchClass: 'bg-health' },
    { key: 'solid_count', label: '辅食', colorVar: '--care', swatchClass: 'bg-care' },
  ]),
  sleep: defineChartSeries([
    {
      key: 'night_hours',
      label: '夜间睡眠',
      exportLabel: '夜间睡眠 (小时)',
      colorVar: '--sleep',
      swatchClass: 'bg-sleep',
    },
    {
      key: 'nap_hours',
      label: '白天小睡',
      exportLabel: '白天小睡 (小时)',
      colorVar: '--feeding',
      swatchClass: 'bg-feeding',
    },
  ]),
  care: defineChartSeries([
    { key: 'pee_count', label: '嘘嘘', exportLabel: '嘘嘘次数', colorVar: '--info', swatchClass: 'bg-info' },
    { key: 'poop_count', label: '便便', exportLabel: '便便次数', colorVar: '--care', swatchClass: 'bg-care' },
  ]),
  health: defineChartSeries([
    {
      key: 'max_temp_c',
      label: '当日最高体温',
      exportLabel: '当日最高体温 (℃)',
      colorVar: '--health',
      swatchClass: 'bg-health',
      swatchStyle: 'dot',
    },
    {
      key: 'low_fever_ref',
      label: '37.3℃',
      exportLabel: '37.3℃ 低热参考',
      colorVar: '--warning',
      swatchClass: 'border-warning',
      swatchStyle: 'dashed',
      referenceOnly: true,
    },
    {
      key: 'high_fever_ref',
      label: '38.5℃',
      exportLabel: '38.5℃ 高热参考',
      colorVar: '--destructive',
      swatchClass: 'border-destructive',
      swatchStyle: 'dashed',
      referenceOnly: true,
    },
  ]),
  rhythm: defineChartSeries([
    { key: 'count', label: '照护次数', exportLabel: '照护记录次数', colorVar: '--sleep', swatchClass: 'bg-sleep' },
  ]),
} as const;

/** 统一拼接图表导出副标题（宝宝昵称 + 月龄 + 周期或参考说明），供统计分析与生长曲线共享。 */
export function formatBabyChartSubtitle(
  baby: Pick<BabyProfile, 'nickname' | 'birth_date'> | null | undefined,
  suffix: string,
): string {
  const parts: string[] = [];
  if (baby?.nickname) {
    const age = baby.birth_date ? formatBabyAge(baby.birth_date).ageLabel : '';
    parts.push(age ? `${baby.nickname}（${age}）` : baby.nickname);
  }
  if (suffix) parts.push(suffix);
  return parts.join(' · ');
}

interface InsightsKpiCard {
  readonly key: 'feeding' | 'sleep' | 'care' | 'health';
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}

interface InsightsFeedingCardView {
  readonly title: string;
  readonly description: string;
  readonly series: ChartSeriesBundle;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}

interface InsightsViewModel {
  readonly headerSubtitle: string;
  readonly exportSubtitle: string;
  readonly filenamePrefix: string;
  readonly xTickGap: number;
  readonly barRadius: [number, number, number, number];
  readonly kpiCards: readonly InsightsKpiCard[];
  readonly feedingCard: InsightsFeedingCardView;
  readonly feedingStats: {
    readonly avgFormulaML: number;
    readonly avgBottleBreastML: number;
    readonly hasDirectBreastData: boolean;
    readonly avgDirectBreastMin: number;
    readonly breastSideTotal: number;
    readonly breastSide: {
      readonly leftCount: number;
      readonly rightCount: number;
      readonly bothCount: number;
      readonly leftPct: number;
      readonly rightPct: number;
      readonly bothPct: number;
    };
    readonly totalSolidCount: number;
    readonly solidAcceptance: {
      readonly total: number;
      readonly likeCount: number;
      readonly neutralCount: number;
      readonly dislikeCount: number;
    };
  };
  readonly sleepCard: {
    readonly isEmpty: boolean;
    readonly emptyTitle: string;
    readonly avgNightHours: number;
    readonly summaryMeta: string;
  };
  readonly careCard: {
    readonly isEmpty: boolean;
    readonly emptyTitle: string;
    readonly avgPeeCount: number;
    readonly avgPoopCount: number;
    readonly totalBathCount: number;
    readonly stoolNotice: string | null;
  };
  readonly healthCard: {
    readonly isEmpty: boolean;
    readonly emptyTitle: string;
    readonly emptyDescription: string;
    readonly totalMedicineCount: number;
  };
  readonly rhythmCard: {
    readonly isEmpty: boolean;
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 统计分析页完整纯函数视图模型：
 * 按对应维度“有记录自然日”聚合日均指标，并直接产出 4 张 KPI 卡片文案、喂养三 Tab 元数据与跨 Tab 空态提示、
 * 健康空态文案、导出副标题及图表布局参数，使路由页保持纯展示形态且全部展示分支可脱离 DOM 测试。
 */
export function buildInsightsViewModel(
  trends: DashboardTrends | undefined,
  baby: Pick<BabyProfile, 'nickname' | 'birth_date'> | null | undefined,
  days: InsightRangeDays,
  feedingTab: FeedingChartTab,
): InsightsViewModel {
  const daily = trends?.daily ?? [];
  const summary = trends?.period_summary;
  const firstDate = daily[0]?.date ?? '';
  const lastDate = daily[daily.length - 1]?.date ?? '';
  const dateRangeLabel = firstDate && lastDate ? `${firstDate} 至 ${lastDate}` : '';

  let sumMilkML = 0;
  let sumFormulaML = 0;
  let sumBottleBreastML = 0;
  let sumDirectBreastMin = 0;
  let sumFeedingCount = 0;
  let totalSolidCount = 0;
  let milkDays = 0;
  let directBreastDays = 0;

  let sumSleepHours = 0;
  let sumNightHours = 0;
  let sumNapCount = 0;

  let sumPeeCount = 0;
  let sumPoopCount = 0;
  let totalBathCount = 0;
  let diaperDays = 0;

  let maxTempInPeriod: number | null = null;
  let totalMedicineCount = 0;

  for (const d of daily) {
    sumMilkML += d.feeding_ml;
    sumFormulaML += d.formula_ml;
    sumBottleBreastML += d.bottle_breast_ml;
    sumDirectBreastMin += d.direct_breast_min;
    sumFeedingCount += d.feeding_count;
    totalSolidCount += d.solid_count;
    if (d.feeding_ml > 0) milkDays++;
    if (d.direct_breast_min > 0 || d.direct_breast_count > 0) directBreastDays++;

    sumSleepHours += d.sleep_hours;
    sumNightHours += d.night_hours;
    sumNapCount += d.nap_count;

    sumPeeCount += d.pee_count;
    sumPoopCount += d.poop_count;
    totalBathCount += d.bath_count;
    if (d.pee_count + d.poop_count > 0) diaperDays++;

    if (d.max_temp_c !== null && (maxTempInPeriod === null || d.max_temp_c > maxTempInPeriod)) {
      maxTempInPeriod = d.max_temp_c;
    }
    totalMedicineCount += d.medicine_count;
  }

  const feedingDays = summary?.active_days.feeding_days ?? daily.filter((d) => d.feeding_count > 0).length;
  const sleepDays = summary?.active_days.sleep_days ?? daily.filter((d) => d.sleep_hours > 0).length;

  const leftCount = summary?.breast_side.left_count ?? 0;
  const rightCount = summary?.breast_side.right_count ?? 0;
  const bothCount = summary?.breast_side.both_count ?? 0;
  const breastSideTotal = leftCount + rightCount + bothCount;

  const likeCount = summary?.solid_acceptance.like_count ?? 0;
  const neutralCount = summary?.solid_acceptance.neutral_count ?? 0;
  const dislikeCount = summary?.solid_acceptance.dislike_count ?? 0;

  const stool = summary?.stool;
  const stoolAlerts: string[] = [];
  if (stool) {
    if (stool.watery_count > 0) stoolAlerts.push(`${STOOL_CONSISTENCY_LABELS.watery} ${stool.watery_count} 次`);
    if (stool.hard_count > 0) stoolAlerts.push(`${STOOL_CONSISTENCY_LABELS.hard} ${stool.hard_count} 次`);
    if (stool.abnormal_color_count > 0) {
      stoolAlerts.push(`${STOOL_COLOR_LABELS.abnormal} ${stool.abnormal_color_count} 次`);
    }
  }
  const stoolNotice =
    stool && stoolAlerts.length > 0
      ? `本周期共排便 ${stool.total_poop_count} 次，其中${stoolAlerts.join('、')}，就医时可作参考。`
      : null;

  const avgMilkML = milkDays > 0 ? Math.round(sumMilkML / milkDays) : 0;
  const avgFormulaML = milkDays > 0 ? Math.round(sumFormulaML / milkDays) : 0;
  const avgBottleBreastML = milkDays > 0 ? Math.round(sumBottleBreastML / milkDays) : 0;
  const avgDirectBreastMin = directBreastDays > 0 ? Math.round(sumDirectBreastMin / directBreastDays) : 0;
  const avgFeedingCount = feedingDays > 0 ? round1(sumFeedingCount / feedingDays) : 0;
  const avgSleepHours = sleepDays > 0 ? round1(sumSleepHours / sleepDays) : 0;
  const avgNightHours = sleepDays > 0 ? round1(sumNightHours / sleepDays) : 0;
  const avgNapCount = sleepDays > 0 ? round1(sumNapCount / sleepDays) : 0;
  const longestNightMin = summary?.sleep.longest_night_min ?? 0;
  const avgNapMin = summary?.sleep.avg_nap_min ?? 0;
  const avgPeeCount = diaperDays > 0 ? round1(sumPeeCount / diaperDays) : 0;
  const avgPoopCount = diaperDays > 0 ? round1(sumPoopCount / diaperDays) : 0;

  const hasMilkData = sumMilkML > 0;
  const hasDirectBreastData = sumDirectBreastMin > 0 || breastSideTotal > 0;
  const hasFeedingCountData = sumFeedingCount > 0;
  const hasSleepData = sumSleepHours > 0;
  const hasCareData = sumPeeCount + sumPoopCount > 0;
  const hasTemperatureData = maxTempInPeriod !== null;
  const hasSlotData = (trends?.slots ?? []).some((s) => s.count > 0);

  const kpiCards: InsightsKpiCard[] = [
    {
      key: 'feeding',
      label: '日均喂养',
      value: hasMilkData ? `${avgMilkML} ml` : hasDirectBreastData ? `${avgDirectBreastMin} 分钟` : '—',
      sub: hasMilkData
        ? `瓶喂 ${milkDays} 天 · 日均 ${avgFeedingCount} 次`
        : hasDirectBreastData
          ? `亲喂 ${directBreastDays} 天 · 日均 ${avgFeedingCount} 次`
          : feedingDays > 0
            ? `有效 ${feedingDays} 天 · 日均 ${avgFeedingCount} 次`
            : `近 ${days} 天暂无喂养`,
    },
    {
      key: 'sleep',
      label: '日均睡眠',
      value: hasSleepData ? `${avgSleepHours} 小时` : '—',
      sub:
        longestNightMin > 0
          ? `最长夜觉 ${formatDurationMin(longestNightMin)}`
          : sleepDays > 0
            ? `日均小睡 ${avgNapCount} 次`
            : `近 ${days} 天暂无睡眠`,
    },
    {
      key: 'care',
      label: '日均排泄',
      value: hasCareData ? `尿 ${avgPeeCount} · 便 ${avgPoopCount}` : '—',
      sub:
        diaperDays > 0
          ? `排泄 ${diaperDays} 天 · 洗澡 ${totalBathCount} 次`
          : totalBathCount > 0
            ? `本周期洗澡共 ${totalBathCount} 次`
            : `近 ${days} 天暂无护理`,
    },
    {
      key: 'health',
      label: '健康记录',
      value:
        maxTempInPeriod !== null
          ? `最高 ${maxTempInPeriod.toFixed(1)} ℃`
          : totalMedicineCount > 0
            ? `用药 ${totalMedicineCount} 次`
            : '平稳',
      sub:
        totalMedicineCount > 0
          ? `本周期共记录用药 ${totalMedicineCount} 次`
          : maxTempInPeriod !== null
            ? '本周期暂无用药记录'
            : '本周期暂无测温或用药记录',
    },
  ];

  const feedingCard: InsightsFeedingCardView =
    feedingTab === 'milk'
      ? {
          title: '每日奶量结构',
          description: '区分配方奶与瓶喂母乳（ml），悬浮可查看亲喂补充',
          series: INSIGHTS_CHART_SERIES.feedingMilk,
          isEmpty: !hasMilkData,
          emptyTitle: `近 ${days} 天暂无奶量记录`,
          emptyDescription: hasDirectBreastData
            ? '当前周期以亲喂为主，可切换到「亲喂时长」或「喂养次数」查看趋势。'
            : '记录配方奶或瓶喂母乳后，这里将按日呈现奶量变化。',
        }
      : feedingTab === 'direct'
        ? {
            title: '每日亲喂时长与侧别',
            description: '统计每日亲喂分钟数，并汇总左/右/双侧喂养均衡度',
            series: INSIGHTS_CHART_SERIES.feedingDirect,
            isEmpty: !hasDirectBreastData,
            emptyTitle: `近 ${days} 天暂无亲喂记录`,
            emptyDescription: '记录亲喂时长与侧别后，可随时查看哺乳时长趋势与两侧均衡比例。',
          }
        : {
            title: '每日喂养次数分布',
            description: '按配方奶、瓶喂母乳、亲喂与辅食拆分每日喂养频次',
            series: INSIGHTS_CHART_SERIES.feedingCounts,
            isEmpty: !hasFeedingCountData,
            emptyTitle: `近 ${days} 天暂无喂养记录`,
            emptyDescription: '记下每一顿奶或辅食后，这里会清晰呈现每日喂养频次变化。',
          };

  const rangeSuffix = dateRangeLabel ? `${dateRangeLabel} · 近 ${days} 天` : `近 ${days} 天`;
  const sleepSummaryMeta = [
    longestNightMin > 0 ? `最长夜觉 ${formatDurationMin(longestNightMin)}` : '',
    avgNapMin > 0 ? `单次小睡均长 ${formatDurationMin(avgNapMin)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    headerSubtitle: dateRangeLabel ? `${dateRangeLabel} · 多维趋势与导出` : '按多时间维度掌握宝宝日常变化',
    exportSubtitle: formatBabyChartSubtitle(baby, rangeSuffix),
    filenamePrefix: baby?.nickname ? `${baby.nickname}-近${days}天` : `近${days}天`,
    xTickGap: days <= 7 ? 8 : days <= 14 ? 14 : 26,
    barRadius: days >= 60 ? [2, 2, 0, 0] : [5, 5, 0, 0],
    kpiCards,
    feedingCard,
    feedingStats: {
      avgFormulaML,
      avgBottleBreastML,
      hasDirectBreastData,
      avgDirectBreastMin,
      breastSideTotal,
      breastSide: {
        leftCount,
        rightCount,
        bothCount,
        leftPct: breastSideTotal > 0 ? Math.round((leftCount / breastSideTotal) * 100) : 0,
        rightPct: breastSideTotal > 0 ? Math.round((rightCount / breastSideTotal) * 100) : 0,
        bothPct: breastSideTotal > 0 ? Math.round((bothCount / breastSideTotal) * 100) : 0,
      },
      totalSolidCount,
      solidAcceptance: {
        total: likeCount + neutralCount + dislikeCount,
        likeCount,
        neutralCount,
        dislikeCount,
      },
    },
    sleepCard: {
      isEmpty: !hasSleepData,
      emptyTitle: `近 ${days} 天暂无睡眠记录`,
      avgNightHours,
      summaryMeta: sleepSummaryMeta,
    },
    careCard: {
      isEmpty: !hasCareData,
      emptyTitle: `近 ${days} 天暂无排泄记录`,
      avgPeeCount,
      avgPoopCount,
      totalBathCount,
      stoolNotice,
    },
    healthCard: {
      isEmpty: !hasTemperatureData,
      emptyTitle: totalMedicineCount > 0 ? `近 ${days} 天暂无体温记录` : `近 ${days} 天宝宝体温平稳无记录`,
      emptyDescription:
        totalMedicineCount > 0
          ? `本周期已记录用药 ${totalMedicineCount} 次；记录体温后可在此查看发热波动曲线。`
          : '发热或接种疫苗后记录体温，这里会自动绘制带参考线的体温曲线，便于就医出示。',
      totalMedicineCount,
    },
    rhythmCard: {
      isEmpty: !hasSlotData,
    },
  };
}
