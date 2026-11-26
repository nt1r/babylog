import type { DashboardTrends } from '@/lib/dashboard';
import { STOOL_COLOR_LABELS, STOOL_CONSISTENCY_LABELS } from '@/lib/records';

export type InsightRangeDays = 7 | 14 | 30 | 90;

export const INSIGHT_RANGE_OPTIONS: ReadonlyArray<{ readonly value: `${InsightRangeDays}`; readonly label: string }> = [
  { value: '7', label: '近 7 天' },
  { value: '14', label: '近 14 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
];

interface InsightsOverview {
  readonly dateRangeLabel: string;
  readonly feedingDays: number;
  readonly milkDays: number;
  readonly directBreastDays: number;
  readonly sleepDays: number;
  readonly diaperDays: number;
  readonly avgMilkML: number;
  readonly avgFormulaML: number;
  readonly avgBottleBreastML: number;
  readonly avgDirectBreastMin: number;
  readonly avgFeedingCount: number;
  readonly totalSolidCount: number;
  readonly avgSleepHours: number;
  readonly avgNightHours: number;
  readonly avgNapCount: number;
  readonly longestNightMin: number;
  readonly avgNapMin: number;
  readonly avgPeeCount: number;
  readonly avgPoopCount: number;
  readonly totalBathCount: number;
  readonly hasMilkData: boolean;
  readonly hasDirectBreastData: boolean;
  readonly hasFeedingCountData: boolean;
  readonly hasSleepData: boolean;
  readonly hasCareData: boolean;
  readonly hasTemperatureData: boolean;
  readonly hasSlotData: boolean;
  readonly breastSideTotal: number;
  readonly breastSide: {
    readonly leftCount: number;
    readonly rightCount: number;
    readonly bothCount: number;
    readonly leftPct: number;
    readonly rightPct: number;
    readonly bothPct: number;
  };
  readonly solidAcceptance: {
    readonly total: number;
    readonly likeCount: number;
    readonly neutralCount: number;
    readonly dislikeCount: number;
  };
  readonly stoolNotice: string | null;
  readonly maxTempInPeriod: number | null;
  readonly totalMedicineCount: number;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 纯函数汇总统计分析页的核心周期指标（全部采用对应维度“有记录自然日”作为分母，避免漏记空白天或无关品类日拉低日均）。
 */
export function computeInsightsOverview(trends: DashboardTrends | undefined): InsightsOverview {
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
    if (stool.abnormal_color_count > 0)
      stoolAlerts.push(`${STOOL_COLOR_LABELS.abnormal} ${stool.abnormal_color_count} 次`);
  }
  const stoolNotice =
    stool && stoolAlerts.length > 0
      ? `本周期共排便 ${stool.total_poop_count} 次，其中${stoolAlerts.join('、')}，就医时可作参考。`
      : null;

  return {
    dateRangeLabel,
    feedingDays,
    milkDays,
    directBreastDays,
    sleepDays,
    diaperDays,
    avgMilkML: milkDays > 0 ? Math.round(sumMilkML / milkDays) : 0,
    avgFormulaML: milkDays > 0 ? Math.round(sumFormulaML / milkDays) : 0,
    avgBottleBreastML: milkDays > 0 ? Math.round(sumBottleBreastML / milkDays) : 0,
    avgDirectBreastMin: directBreastDays > 0 ? Math.round(sumDirectBreastMin / directBreastDays) : 0,
    avgFeedingCount: feedingDays > 0 ? round1(sumFeedingCount / feedingDays) : 0,
    totalSolidCount,
    avgSleepHours: sleepDays > 0 ? round1(sumSleepHours / sleepDays) : 0,
    avgNightHours: sleepDays > 0 ? round1(sumNightHours / sleepDays) : 0,
    avgNapCount: sleepDays > 0 ? round1(sumNapCount / sleepDays) : 0,
    longestNightMin: summary?.sleep.longest_night_min ?? 0,
    avgNapMin: summary?.sleep.avg_nap_min ?? 0,
    avgPeeCount: diaperDays > 0 ? round1(sumPeeCount / diaperDays) : 0,
    avgPoopCount: diaperDays > 0 ? round1(sumPoopCount / diaperDays) : 0,
    totalBathCount,
    hasMilkData: sumMilkML > 0,
    hasDirectBreastData: sumDirectBreastMin > 0 || breastSideTotal > 0,
    hasFeedingCountData: sumFeedingCount > 0,
    hasSleepData: sumSleepHours > 0,
    hasCareData: sumPeeCount + sumPoopCount > 0,
    hasTemperatureData: maxTempInPeriod !== null,
    hasSlotData: (trends?.slots ?? []).some((s) => s.count > 0),
    breastSideTotal,
    breastSide: {
      leftCount,
      rightCount,
      bothCount,
      leftPct: breastSideTotal > 0 ? Math.round((leftCount / breastSideTotal) * 100) : 0,
      rightPct: breastSideTotal > 0 ? Math.round((rightCount / breastSideTotal) * 100) : 0,
      bothPct: breastSideTotal > 0 ? Math.round((bothCount / breastSideTotal) * 100) : 0,
    },
    solidAcceptance: {
      total: likeCount + neutralCount + dislikeCount,
      likeCount,
      neutralCount,
      dislikeCount,
    },
    stoolNotice,
    maxTempInPeriod,
    totalMedicineCount,
  };
}
