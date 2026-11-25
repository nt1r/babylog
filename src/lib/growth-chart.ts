import type { BabyGender, BabyProfile } from '@/lib/baby';
import type { HealthRecord } from '@/lib/records';
import { getLocalDateKeyFromISO } from '@/lib/time';

export type GrowthChartMetric = 'weight' | 'height' | 'head';

interface WhoAnchorPoint {
  readonly month: number;
  readonly p3: number;
  readonly p50: number;
  readonly p97: number;
}

export interface GrowthChartPoint {
  readonly ageMonths: number;
  readonly whoP3: number;
  readonly whoP50: number;
  readonly whoP97: number;
  readonly whoRange: [number, number];
  /** 仅在宝宝有真实测量（或出生基准）时存在数值，供折线 connectNulls 连续绘制。 */
  readonly value: number | null;
  readonly dateKey: string | null;
  readonly isBirth?: boolean;
}

interface GrowthChartSeries {
  readonly metric: GrowthChartMetric;
  readonly unit: string;
  readonly label: string;
  readonly genderLabel: string;
  readonly points: readonly GrowthChartPoint[];
  readonly measurementCount: number;
  /** 超出 WHO 0–60 月龄标准覆盖上限的记录条数，用于界面友好提示而非静默隐藏。 */
  readonly beyondWhoCount: number;
  readonly maxMonth: number;
  readonly yDomain: [number, number];
  readonly latestPoint: GrowthChartPoint | null;
  readonly latestBandStatus: 'in_range' | 'above' | 'below' | null;
}

const METRIC_META: Record<GrowthChartMetric, { label: string; unit: string }> = {
  weight: { label: '体重', unit: 'kg' },
  height: { label: '身高', unit: 'cm' },
  head: { label: '头围', unit: 'cm' },
};

// WHO 2006 儿童生长标准（0–60 月龄）关键月龄 P3 / P50 / P97 参考锚点，中间月龄线性插值。
const WHO_STANDARDS: Record<GrowthChartMetric, Record<'male' | 'female', readonly WhoAnchorPoint[]>> = {
  weight: {
    male: [
      { month: 0, p3: 2.5, p50: 3.3, p97: 4.3 },
      { month: 1, p3: 3.4, p50: 4.5, p97: 5.7 },
      { month: 2, p3: 4.4, p50: 5.6, p97: 7.0 },
      { month: 3, p3: 5.1, p50: 6.4, p97: 7.9 },
      { month: 4, p3: 5.6, p50: 7.0, p97: 8.6 },
      { month: 5, p3: 6.1, p50: 7.5, p97: 9.2 },
      { month: 6, p3: 6.4, p50: 7.9, p97: 9.7 },
      { month: 9, p3: 7.2, p50: 8.9, p97: 10.9 },
      { month: 12, p3: 7.8, p50: 9.6, p97: 11.8 },
      { month: 15, p3: 8.4, p50: 10.3, p97: 12.7 },
      { month: 18, p3: 8.9, p50: 10.9, p97: 13.5 },
      { month: 24, p3: 9.8, p50: 12.2, p97: 15.1 },
      { month: 36, p3: 11.4, p50: 14.3, p97: 18.0 },
      { month: 48, p3: 12.9, p50: 16.3, p97: 20.9 },
      { month: 60, p3: 14.3, p50: 18.3, p97: 23.8 },
    ],
    female: [
      { month: 0, p3: 2.4, p50: 3.2, p97: 4.2 },
      { month: 1, p3: 3.2, p50: 4.2, p97: 5.4 },
      { month: 2, p3: 4.0, p50: 5.1, p97: 6.5 },
      { month: 3, p3: 4.6, p50: 5.8, p97: 7.4 },
      { month: 4, p3: 5.1, p50: 6.4, p97: 8.1 },
      { month: 5, p3: 5.5, p50: 6.9, p97: 8.7 },
      { month: 6, p3: 5.8, p50: 7.3, p97: 9.2 },
      { month: 9, p3: 6.6, p50: 8.2, p97: 10.4 },
      { month: 12, p3: 7.1, p50: 8.9, p97: 11.3 },
      { month: 15, p3: 7.7, p50: 9.6, p97: 12.2 },
      { month: 18, p3: 8.2, p50: 10.2, p97: 13.0 },
      { month: 24, p3: 9.2, p50: 11.5, p97: 14.6 },
      { month: 36, p3: 11.0, p50: 13.9, p97: 17.8 },
      { month: 48, p3: 12.5, p50: 16.1, p97: 21.1 },
      { month: 60, p3: 14.0, p50: 18.2, p97: 24.4 },
    ],
  },
  height: {
    male: [
      { month: 0, p3: 46.3, p50: 49.9, p97: 53.4 },
      { month: 1, p3: 51.1, p50: 54.7, p97: 58.4 },
      { month: 2, p3: 54.7, p50: 58.4, p97: 62.2 },
      { month: 3, p3: 57.6, p50: 61.4, p97: 65.3 },
      { month: 4, p3: 60.0, p50: 63.9, p97: 67.8 },
      { month: 5, p3: 61.9, p50: 65.9, p97: 69.9 },
      { month: 6, p3: 63.6, p50: 67.6, p97: 71.6 },
      { month: 9, p3: 67.7, p50: 72.0, p97: 76.2 },
      { month: 12, p3: 71.3, p50: 75.7, p97: 80.2 },
      { month: 15, p3: 74.4, p50: 79.1, p97: 83.9 },
      { month: 18, p3: 77.2, p50: 82.3, p97: 87.3 },
      { month: 24, p3: 81.7, p50: 87.8, p97: 93.2 },
      { month: 36, p3: 89.0, p50: 96.1, p97: 103.1 },
      { month: 48, p3: 95.4, p50: 103.3, p97: 111.2 },
      { month: 60, p3: 101.2, p50: 110.0, p97: 118.7 },
    ],
    female: [
      { month: 0, p3: 45.6, p50: 49.1, p97: 52.7 },
      { month: 1, p3: 50.0, p50: 53.7, p97: 57.4 },
      { month: 2, p3: 53.2, p50: 57.1, p97: 60.9 },
      { month: 3, p3: 55.8, p50: 59.8, p97: 63.8 },
      { month: 4, p3: 58.0, p50: 62.1, p97: 66.2 },
      { month: 5, p3: 59.9, p50: 64.0, p97: 68.2 },
      { month: 6, p3: 61.5, p50: 65.7, p97: 70.0 },
      { month: 9, p3: 65.6, p50: 70.1, p97: 74.7 },
      { month: 12, p3: 69.2, p50: 74.0, p97: 78.9 },
      { month: 15, p3: 72.4, p50: 77.5, p97: 82.7 },
      { month: 18, p3: 75.2, p50: 80.7, p97: 86.2 },
      { month: 24, p3: 80.3, p50: 86.4, p97: 92.5 },
      { month: 36, p3: 87.9, p50: 95.1, p97: 102.2 },
      { month: 48, p3: 94.6, p50: 102.7, p97: 110.8 },
      { month: 60, p3: 100.5, p50: 109.4, p97: 118.4 },
    ],
  },
  head: {
    male: [
      { month: 0, p3: 32.1, p50: 34.5, p97: 36.9 },
      { month: 1, p3: 35.1, p50: 37.3, p97: 39.5 },
      { month: 2, p3: 36.9, p50: 39.1, p97: 41.3 },
      { month: 3, p3: 38.3, p50: 40.5, p97: 42.7 },
      { month: 4, p3: 39.4, p50: 41.6, p97: 43.9 },
      { month: 5, p3: 40.3, p50: 42.6, p97: 44.8 },
      { month: 6, p3: 41.0, p50: 43.3, p97: 45.6 },
      { month: 9, p3: 42.6, p50: 45.0, p97: 47.4 },
      { month: 12, p3: 43.6, p50: 46.1, p97: 48.5 },
      { month: 15, p3: 44.4, p50: 46.8, p97: 49.3 },
      { month: 18, p3: 44.9, p50: 47.4, p97: 49.9 },
      { month: 24, p3: 45.7, p50: 48.3, p97: 50.8 },
      { month: 36, p3: 46.9, p50: 49.5, p97: 52.1 },
      { month: 48, p3: 47.6, p50: 50.2, p97: 52.9 },
      { month: 60, p3: 48.1, p50: 50.7, p97: 53.4 },
    ],
    female: [
      { month: 0, p3: 31.7, p50: 33.9, p97: 36.1 },
      { month: 1, p3: 34.3, p50: 36.5, p97: 38.8 },
      { month: 2, p3: 36.0, p50: 38.3, p97: 40.5 },
      { month: 3, p3: 37.2, p50: 39.5, p97: 41.9 },
      { month: 4, p3: 38.2, p50: 40.6, p97: 43.0 },
      { month: 5, p3: 39.0, p50: 41.5, p97: 43.9 },
      { month: 6, p3: 39.7, p50: 42.2, p97: 44.6 },
      { month: 9, p3: 41.3, p50: 43.8, p97: 46.3 },
      { month: 12, p3: 42.3, p50: 44.9, p97: 47.5 },
      { month: 15, p3: 43.1, p50: 45.7, p97: 48.3 },
      { month: 18, p3: 43.6, p50: 46.2, p97: 48.9 },
      { month: 24, p3: 44.6, p50: 47.2, p97: 49.8 },
      { month: 36, p3: 45.9, p50: 48.5, p97: 51.1 },
      { month: 48, p3: 46.7, p50: 49.3, p97: 51.9 },
      { month: 60, p3: 47.3, p50: 49.9, p97: 52.5 },
    ],
  },
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDateKeyToUtcMs(dateKey: string): number | null {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

/** 按 30.4375 天/月计算精确月龄（保留两位小数，约 0.3 天精度，确保相邻自然日互不碰撞）。 */
function computeAgeMonths(birthDateKey: string, targetDateKey: string): number | null {
  const birthMs = parseDateKeyToUtcMs(birthDateKey);
  const targetMs = parseDateKeyToUtcMs(targetDateKey);
  if (birthMs === null || targetMs === null) return null;
  const diffDays = Math.round((targetMs - birthMs) / 86_400_000);
  // 拒绝早于出生日期的异常历史测量；同日计为 0 月龄。
  if (diffDays < 0) return null;
  return round2(diffDays / 30.4375);
}

function getWhoAnchors(metric: GrowthChartMetric, gender: BabyGender): WhoAnchorPoint[] {
  const pair = WHO_STANDARDS[metric];
  if (gender === 'male') return [...pair.male];
  if (gender === 'female') return [...pair.female];
  return pair.male.map((m, idx) => {
    const f = pair.female[idx];
    return {
      month: m.month,
      p3: round1((m.p3 + f.p3) / 2),
      p50: round1((m.p50 + f.p50) / 2),
      p97: round1((m.p97 + f.p97) / 2),
    };
  });
}

/** 基于给定 WHO 参考锚点对任意月龄做线性插值（超出 60 月龄按端点钳位）。 */
function interpolateWhoBand(
  anchors: readonly WhoAnchorPoint[],
  ageMonths: number,
): { p3: number; p50: number; p97: number } {
  const clamped = Math.max(0, Math.min(60, ageMonths));
  if (clamped <= anchors[0].month) {
    return { p3: anchors[0].p3, p50: anchors[0].p50, p97: anchors[0].p97 };
  }
  const last = anchors[anchors.length - 1];
  if (clamped >= last.month) {
    return { p3: last.p3, p50: last.p50, p97: last.p97 };
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (clamped >= a.month && clamped <= b.month) {
      const ratio = (clamped - a.month) / (b.month - a.month);
      return {
        p3: round2(a.p3 + (b.p3 - a.p3) * ratio),
        p50: round2(a.p50 + (b.p50 - a.p50) * ratio),
        p97: round2(a.p97 + (b.p97 - a.p97) * ratio),
      };
    }
  }
  return { p3: last.p3, p50: last.p50, p97: last.p97 };
}

function extractMetricValue(rec: HealthRecord, metric: GrowthChartMetric): number | null {
  if (metric === 'weight') return rec.weight_kg;
  if (metric === 'height') return rec.height_cm;
  return rec.head_cm;
}

function resolveDisplayMaxMonth(maxDataMonth: number): number {
  if (maxDataMonth <= 6) return 6;
  if (maxDataMonth <= 12) return 12;
  if (maxDataMonth <= 18) return 18;
  if (maxDataMonth <= 24) return 24;
  if (maxDataMonth <= 36) return 36;
  if (maxDataMonth <= 48) return 48;
  return 60;
}

/**
 * 构建带 WHO P3–P97 参考区间与 P50 中位线的生长趋势序列：
 * - 按本地自然日（dateKey）去重，同日多条记录保留时间戳最新者；
 * - 自动将宝宝档案中的出生体重/身高作为出生当天（0 月龄）基准点，仅在出生当天存在手动测量时才被覆盖；
 * - 合并 WHO 参考锚点与宝宝实测月龄，使参考带始终平滑且实测点按真实月龄对齐。
 */
export function buildGrowthChartSeries(
  metric: GrowthChartMetric,
  records: readonly HealthRecord[],
  baby: Pick<BabyProfile, 'birth_date' | 'gender' | 'birth_weight_kg' | 'birth_height_cm'> | null | undefined,
): GrowthChartSeries {
  const meta = METRIC_META[metric];
  const gender: BabyGender = baby?.gender ?? 'unknown';
  const genderLabel = gender === 'male' ? '男宝' : gender === 'female' ? '女宝' : '综合';
  const anchors = getWhoAnchors(metric, gender);

  // 先按自然日 YYYY-MM-DD 去重，避免新生儿期相邻 1–2 天记录落入近似月龄而互相覆盖。
  const byDateKey = new Map<
    string,
    { ageMonths: number; value: number; dateKey: string; recordedAtMs: number; isBirth?: boolean }
  >();
  let beyondWhoCount = 0;

  if (baby?.birth_date) {
    const birthValue = metric === 'weight' ? baby.birth_weight_kg : metric === 'height' ? baby.birth_height_cm : null;
    if (birthValue !== null && birthValue > 0) {
      byDateKey.set(baby.birth_date, {
        ageMonths: 0,
        value: birthValue,
        dateKey: baby.birth_date,
        recordedAtMs: Number.NEGATIVE_INFINITY,
        isBirth: true,
      });
    }

    for (const rec of records) {
      if (rec.subtype !== 'growth') continue;
      const val = extractMetricValue(rec, metric);
      if (val === null || val <= 0) continue;
      const dateKey = getLocalDateKeyFromISO(rec.recorded_at);
      const ageMonths = computeAgeMonths(baby.birth_date, dateKey);
      if (ageMonths === null) continue;
      if (ageMonths > 60) {
        beyondWhoCount += 1;
        continue;
      }

      const recordedAtMs = Date.parse(rec.recorded_at);
      const safeMs = Number.isFinite(recordedAtMs) ? recordedAtMs : 0;
      const existing = byDateKey.get(dateKey);
      if (!existing || existing.isBirth || safeMs >= existing.recordedAtMs) {
        byDateKey.set(dateKey, {
          ageMonths,
          value: val,
          dateKey,
          recordedAtMs: safeMs,
          isBirth: false,
        });
      }
    }
  }

  const measuredByAge = new Map<number, { value: number; dateKey: string; isBirth?: boolean }>();
  let maxMeasuredMonth = 0;
  for (const entry of byDateKey.values()) {
    measuredByAge.set(entry.ageMonths, {
      value: entry.value,
      dateKey: entry.dateKey,
      isBirth: entry.isBirth,
    });
    if (entry.ageMonths > maxMeasuredMonth) {
      maxMeasuredMonth = entry.ageMonths;
    }
  }

  const maxMonth = resolveDisplayMaxMonth(maxMeasuredMonth);
  const monthSet = new Set<number>();
  for (const anchor of anchors) {
    if (anchor.month <= maxMonth) {
      monthSet.add(anchor.month);
    }
  }
  for (const age of measuredByAge.keys()) {
    if (age <= maxMonth) {
      monthSet.add(age);
    }
  }

  const sortedMonths = Array.from(monthSet).sort((a, b) => a - b);
  const points: GrowthChartPoint[] = sortedMonths.map((ageMonths) => {
    const band = interpolateWhoBand(anchors, ageMonths);
    const measured = measuredByAge.get(ageMonths);
    return {
      ageMonths,
      whoP3: band.p3,
      whoP50: band.p50,
      whoP97: band.p97,
      whoRange: [band.p3, band.p97],
      value: measured ? measured.value : null,
      dateKey: measured ? measured.dateKey : null,
      isBirth: measured?.isBirth,
    };
  });

  const measuredPoints = points.filter((p) => p.value !== null);
  const latestPoint = measuredPoints[measuredPoints.length - 1] ?? null;

  let latestBandStatus: GrowthChartSeries['latestBandStatus'] = null;
  if (latestPoint && latestPoint.value !== null) {
    if (latestPoint.value < latestPoint.whoP3) {
      latestBandStatus = 'below';
    } else if (latestPoint.value > latestPoint.whoP97) {
      latestBandStatus = 'above';
    } else {
      latestBandStatus = 'in_range';
    }
  }

  // 计算合理的 Y 轴范围，确保 WHO 参考带与宝宝实测极值均留有呼吸边距。
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minY = Math.min(minY, p.whoP3, p.value ?? Number.POSITIVE_INFINITY);
    maxY = Math.max(maxY, p.whoP97, p.value ?? Number.NEGATIVE_INFINITY);
  }
  const pad = metric === 'weight' ? 1 : 3;
  const yDomain: [number, number] =
    Number.isFinite(minY) && Number.isFinite(maxY)
      ? [Math.max(0, Math.floor(minY - pad)), Math.ceil(maxY + pad)]
      : [0, 10];

  return {
    metric,
    unit: meta.unit,
    label: meta.label,
    genderLabel,
    points,
    measurementCount: measuredPoints.length,
    beyondWhoCount,
    maxMonth,
    yDomain,
    latestPoint,
    latestBandStatus,
  };
}
