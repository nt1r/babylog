import { createFileRoute } from '@tanstack/react-router';
import {
  Baby,
  BarChart3,
  Clock3,
  FileSpreadsheet,
  HeartPulse,
  Milk,
  MoonStar,
  PlusIcon,
  Thermometer,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { InsightChartCard } from '@/components/insights/insight-chart-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { SegmentedControl } from '@/components/ui/choice-controls';
import { InfoPopover } from '@/components/ui/info-popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveBaby } from '@/lib/baby';
import type { ChartExportLegendItem } from '@/lib/chart-export';
import { type DashboardTrends, useDashboardTrendsQuery } from '@/lib/dashboard';
import { computeInsightsOverview, INSIGHT_RANGE_OPTIONS, type InsightRangeDays } from '@/lib/insights';
import { ACCEPTANCE_LABELS } from '@/lib/records';
import { formatBabyAge, formatDurationMin } from '@/lib/time';
import { useExportDrawerStore } from '@/stores/export-drawer';
import { useQuickRecordStore } from '@/stores/quick-record';

export const Route = createFileRoute('/_app/insights')({
  component: InsightsPage,
});

type DailyPoint = DashboardTrends['daily'][number];
type FeedingChartTab = 'milk' | 'direct' | 'counts';

const MILK_CHART_CONFIG: ChartConfig = {
  formula_ml: { label: '配方奶', color: 'var(--feeding)' },
  bottle_breast_ml: { label: '瓶喂母乳', color: 'var(--primary)' },
};

const DIRECT_CHART_CONFIG: ChartConfig = {
  direct_breast_min: { label: '亲喂时长', color: 'var(--feeding)' },
};

const COUNTS_CHART_CONFIG: ChartConfig = {
  formula_count: { label: '配方奶', color: 'var(--feeding)' },
  bottle_breast_count: { label: '瓶喂母乳', color: 'var(--primary)' },
  direct_breast_count: { label: '亲喂', color: 'var(--health)' },
  solid_count: { label: '辅食', color: 'var(--care)' },
};

const SLEEP_CHART_CONFIG: ChartConfig = {
  night_hours: { label: '夜间睡眠', color: 'var(--sleep)' },
  nap_hours: { label: '白天小睡', color: 'var(--feeding)' },
};

const CARE_CHART_CONFIG: ChartConfig = {
  pee_count: { label: '嘘嘘', color: 'var(--info)' },
  poop_count: { label: '便便', color: 'var(--care)' },
};

const HEALTH_CHART_CONFIG: ChartConfig = {
  max_temp_c: { label: '最高体温', color: 'var(--health)' },
};

const SLOT_CHART_CONFIG: ChartConfig = {
  count: { label: '照护次数', color: 'var(--sleep)' },
};

const MILK_LEGEND: readonly ChartExportLegendItem[] = [
  { label: '配方奶 (ml)', colorVar: '--feeding' },
  { label: '瓶喂母乳 (ml)', colorVar: '--primary' },
];

const DIRECT_LEGEND: readonly ChartExportLegendItem[] = [{ label: '亲喂时长 (分钟)', colorVar: '--feeding' }];

const COUNTS_LEGEND: readonly ChartExportLegendItem[] = [
  { label: '配方奶', colorVar: '--feeding' },
  { label: '瓶喂母乳', colorVar: '--primary' },
  { label: '亲喂', colorVar: '--health' },
  { label: '辅食', colorVar: '--care' },
];

const SLEEP_LEGEND: readonly ChartExportLegendItem[] = [
  { label: '夜间睡眠 (小时)', colorVar: '--sleep' },
  { label: '白天小睡 (小时)', colorVar: '--feeding' },
];

const CARE_LEGEND: readonly ChartExportLegendItem[] = [
  { label: '嘘嘘次数', colorVar: '--info' },
  { label: '便便次数', colorVar: '--care' },
];

const HEALTH_LEGEND: readonly ChartExportLegendItem[] = [
  { label: '当日最高体温 (℃)', colorVar: '--health' },
  { label: '37.3℃ 低热参考', colorVar: '--warning' },
  { label: '38.5℃ 高热参考', colorVar: '--destructive' },
];

const SLOT_LEGEND: readonly ChartExportLegendItem[] = [{ label: '照护记录次数', colorVar: '--sleep' }];

function FeedingTooltip({
  active,
  payload,
  mode,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ payload?: DailyPoint }>;
  readonly mode: FeedingChartTab;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;

  return (
    <div className="grid min-w-44 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium text-foreground tabular-nums">{p.date}</div>
      {mode === 'milk' ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-4 font-medium text-foreground">
            <span>总奶量</span>
            <span className="tabular-nums">{p.feeding_ml} ml</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-feeding" />
              配方奶
            </span>
            <span className="tabular-nums">
              {p.formula_ml} ml（{p.formula_count} 次）
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              瓶喂母乳
            </span>
            <span className="tabular-nums">
              {p.bottle_breast_ml} ml（{p.bottle_breast_count} 次）
            </span>
          </div>
          {p.direct_breast_count > 0 ? (
            <div className="flex items-center justify-between gap-4 text-muted-foreground">
              <span>亲喂补充</span>
              <span className="tabular-nums">
                {p.direct_breast_count} 次 · {formatDurationMin(p.direct_breast_min)}
              </span>
            </div>
          ) : null}
        </div>
      ) : mode === 'direct' ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full bg-feeding" />
              亲喂时长
            </span>
            <span className="font-medium text-foreground tabular-nums">{formatDurationMin(p.direct_breast_min)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>亲喂次数</span>
            <span className="font-medium text-foreground tabular-nums">{p.direct_breast_count} 次</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-4 font-medium text-foreground">
            <span>当日总计</span>
            <span className="tabular-nums">{p.feeding_count} 次</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-feeding" />
              配方奶
            </span>
            <span className="tabular-nums">{p.formula_count} 次</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              瓶喂母乳
            </span>
            <span className="tabular-nums">{p.bottle_breast_count} 次</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-health" />
              亲喂
            </span>
            <span className="tabular-nums">{p.direct_breast_count} 次</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-care" />
              辅食
            </span>
            <span className="tabular-nums">{p.solid_count} 次</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SleepTooltip({
  active,
  payload,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ payload?: DailyPoint }>;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium text-foreground tabular-nums">{p.date}</div>
      <div className="flex items-center justify-between gap-4 font-medium text-foreground">
        <span>总睡眠</span>
        <span className="tabular-nums">{p.sleep_hours} 小时</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-sleep" />
          夜间睡眠
        </span>
        <span className="tabular-nums">{p.night_hours} 小时</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-feeding" />
          白天小睡
        </span>
        <span className="tabular-nums">
          {p.nap_hours} 小时（{p.nap_count} 次）
        </span>
      </div>
    </div>
  );
}

function CareTooltip({
  active,
  payload,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ payload?: DailyPoint }>;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="grid min-w-36 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium text-foreground tabular-nums">{p.date}</div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-info" />
          嘘嘘
        </span>
        <span className="font-medium text-foreground tabular-nums">{p.pee_count} 次</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-care" />
          便便
        </span>
        <span className="font-medium text-foreground tabular-nums">{p.poop_count} 次</span>
      </div>
      {p.bath_count > 0 ? (
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>洗澡</span>
          <span className="tabular-nums">{p.bath_count} 次</span>
        </div>
      ) : null}
    </div>
  );
}

function HealthTooltip({
  active,
  payload,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ payload?: DailyPoint }>;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium text-foreground tabular-nums">{p.date}</div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-health" />
          最高体温
        </span>
        <span className="font-medium text-foreground tabular-nums">
          {p.max_temp_c !== null ? `${p.max_temp_c.toFixed(1)} ℃` : '未测温'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span>当日用药</span>
        <span className="font-medium text-foreground tabular-nums">{p.medicine_count} 次</span>
      </div>
    </div>
  );
}

function InsightsPage() {
  const [days, setDays] = useState<InsightRangeDays>(30);
  const [feedingTab, setFeedingTab] = useState<FeedingChartTab>('milk');

  const { activeBaby } = useActiveBaby();
  const openCreate = useQuickRecordStore((s) => s.openCreate);
  const openExport = useExportDrawerStore((s) => s.openExport);
  const trendsQuery = useDashboardTrendsQuery(days);

  const trends = trendsQuery.data;
  const daily = trends?.daily ?? [];
  const overview = useMemo(() => computeInsightsOverview(trends), [trends]);

  const babyContextSubtitle = useMemo(() => {
    const parts: string[] = [];
    if (activeBaby?.nickname) {
      const age = activeBaby.birth_date ? formatBabyAge(activeBaby.birth_date).ageLabel : '';
      parts.push(age ? `${activeBaby.nickname}（${age}）` : activeBaby.nickname);
    }
    if (overview.dateRangeLabel) {
      parts.push(`${overview.dateRangeLabel} · 近 ${days} 天`);
    } else {
      parts.push(`近 ${days} 天`);
    }
    return parts.join(' · ');
  }, [activeBaby, overview.dateRangeLabel, days]);

  const filenamePrefix = activeBaby?.nickname ? `${activeBaby.nickname}-近${days}天` : `近${days}天`;
  const xTickGap = days <= 7 ? 8 : days <= 14 ? 14 : 26;
  const barRadius: [number, number, number, number] = days >= 60 ? [2, 2, 0, 0] : [5, 5, 0, 0];

  const feedingCardMeta =
    feedingTab === 'milk'
      ? {
          title: '每日奶量结构',
          desc: '区分配方奶与瓶喂母乳（ml），悬浮可查看亲喂补充',
          legend: MILK_LEGEND,
          isEmpty: !overview.hasMilkData,
          emptyTitle: `近 ${days} 天暂无奶量记录`,
          emptyDesc: overview.hasDirectBreastData
            ? '当前周期以亲喂为主，可切换到「亲喂时长」或「喂养次数」查看趋势。'
            : '记录配方奶或瓶喂母乳后，这里将按日呈现奶量变化。',
        }
      : feedingTab === 'direct'
        ? {
            title: '每日亲喂时长与侧别',
            desc: '统计每日亲喂分钟数，并汇总左/右/双侧喂养均衡度',
            legend: DIRECT_LEGEND,
            isEmpty: !overview.hasDirectBreastData,
            emptyTitle: `近 ${days} 天暂无亲喂记录`,
            emptyDesc: '记录亲喂时长与侧别后，可随时查看哺乳时长趋势与两侧均衡比例。',
          }
        : {
            title: '每日喂养次数分布',
            desc: '按配方奶、瓶喂母乳、亲喂与辅食拆分每日喂养频次',
            legend: COUNTS_LEGEND,
            isEmpty: !overview.hasFeedingCountData,
            emptyTitle: `近 ${days} 天暂无喂养记录`,
            emptyDesc: '记下每一顿奶或辅食后，这里会清晰呈现每日喂养频次变化。',
          };

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      {/* 顶部工具栏：时间范围切换 + Excel 表格导出入口 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">统计分析</h1>
            <InfoPopover title="统计口径说明" ariaLabel="查看统计口径说明">
              <div className="space-y-2">
                <p>
                  顶部日均指标均按<span className="font-medium text-foreground">「有记录的自然日」</span>
                  计算，避免漏记的空白天把平均值拉低。
                </p>
                <p>跨夜睡眠已按本地零点自动拆分到对应自然日；每张图表均可一键保存高清图片，方便发给家人或就医出示。</p>
              </div>
            </InfoPopover>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {overview.dateRangeLabel ? `${overview.dateRangeLabel} · 多维趋势与导出` : '按多时间维度掌握宝宝日常变化'}
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <SegmentedControl
            ariaLabel="选择统计时间范围"
            options={INSIGHT_RANGE_OPTIONS}
            value={`${days}`}
            onChange={(val) => setDays(Number(val) as InsightRangeDays)}
            columns={4}
          />
          <Button type="button" variant="outline" onClick={() => openExport(`${days}`)} className="h-10 gap-1.5 sm:h-9">
            <FileSpreadsheet className="size-4 text-primary" strokeWidth={1.8} />
            <span>导出表格</span>
          </Button>
        </div>
      </div>

      {/* 周期日均核心摘要条（与首页看板 KPI 卡片保持统一结构与留白规范） */}
      <section aria-label="周期统计摘要" className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4 @4xl/main:gap-4">
        <Card className="h-full gap-2.5 [--card-spacing:--spacing(3.5)] sm:gap-3 sm:[--card-spacing:--spacing(5)]">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardDescription className="truncate text-[13px] font-medium text-muted-foreground sm:text-sm">
              日均喂养
            </CardDescription>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-feeding-soft text-feeding-soft-foreground sm:size-9">
              <Milk className="size-4 sm:size-4.5" strokeWidth={1.8} />
            </span>
          </CardHeader>
          <CardContent className="space-y-1 sm:space-y-1.5">
            {trendsQuery.isLoading ? (
              <Skeleton className="h-7 w-20 rounded-lg sm:h-8 sm:w-24" />
            ) : (
              <p className="truncate text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-2xl">
                {overview.hasMilkData
                  ? `${overview.avgMilkML} ml`
                  : overview.hasDirectBreastData
                    ? `${overview.avgDirectBreastMin} 分钟`
                    : '—'}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {overview.hasMilkData
                ? `瓶喂 ${overview.milkDays} 天 · 日均 ${overview.avgFeedingCount} 次`
                : overview.hasDirectBreastData
                  ? `亲喂 ${overview.directBreastDays} 天 · 日均 ${overview.avgFeedingCount} 次`
                  : overview.feedingDays > 0
                    ? `有效 ${overview.feedingDays} 天 · 日均 ${overview.avgFeedingCount} 次`
                    : `近 ${days} 天暂无喂养`}
            </p>
          </CardContent>
        </Card>

        <Card className="h-full gap-2.5 [--card-spacing:--spacing(3.5)] sm:gap-3 sm:[--card-spacing:--spacing(5)]">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardDescription className="truncate text-[13px] font-medium text-muted-foreground sm:text-sm">
              日均睡眠
            </CardDescription>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sleep-soft text-sleep-soft-foreground sm:size-9">
              <MoonStar className="size-4 sm:size-4.5" strokeWidth={1.8} />
            </span>
          </CardHeader>
          <CardContent className="space-y-1 sm:space-y-1.5">
            {trendsQuery.isLoading ? (
              <Skeleton className="h-7 w-20 rounded-lg sm:h-8 sm:w-24" />
            ) : (
              <p className="truncate text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-2xl">
                {overview.hasSleepData ? `${overview.avgSleepHours} 小时` : '—'}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {overview.longestNightMin > 0
                ? `最长夜觉 ${formatDurationMin(overview.longestNightMin)}`
                : overview.sleepDays > 0
                  ? `日均小睡 ${overview.avgNapCount} 次`
                  : `近 ${days} 天暂无睡眠`}
            </p>
          </CardContent>
        </Card>

        <Card className="h-full gap-2.5 [--card-spacing:--spacing(3.5)] sm:gap-3 sm:[--card-spacing:--spacing(5)]">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardDescription className="truncate text-[13px] font-medium text-muted-foreground sm:text-sm">
              日均排泄
            </CardDescription>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-care-soft text-care-soft-foreground sm:size-9">
              <Baby className="size-4 sm:size-4.5" strokeWidth={1.8} />
            </span>
          </CardHeader>
          <CardContent className="space-y-1 sm:space-y-1.5">
            {trendsQuery.isLoading ? (
              <Skeleton className="h-7 w-20 rounded-lg sm:h-8 sm:w-24" />
            ) : (
              <p className="truncate text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-2xl">
                {overview.hasCareData ? `尿 ${overview.avgPeeCount} · 便 ${overview.avgPoopCount}` : '—'}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {overview.diaperDays > 0
                ? `排泄 ${overview.diaperDays} 天 · 洗澡 ${overview.totalBathCount} 次`
                : overview.totalBathCount > 0
                  ? `本周期洗澡共 ${overview.totalBathCount} 次`
                  : `近 ${days} 天暂无护理`}
            </p>
          </CardContent>
        </Card>

        <Card className="h-full gap-2.5 [--card-spacing:--spacing(3.5)] sm:gap-3 sm:[--card-spacing:--spacing(5)]">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardDescription className="truncate text-[13px] font-medium text-muted-foreground sm:text-sm">
              健康记录
            </CardDescription>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-health-soft text-health-soft-foreground sm:size-9">
              <HeartPulse className="size-4 sm:size-4.5" strokeWidth={1.8} />
            </span>
          </CardHeader>
          <CardContent className="space-y-1 sm:space-y-1.5">
            {trendsQuery.isLoading ? (
              <Skeleton className="h-7 w-20 rounded-lg sm:h-8 sm:w-24" />
            ) : (
              <p className="truncate text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-2xl">
                {overview.maxTempInPeriod !== null
                  ? `最高 ${overview.maxTempInPeriod.toFixed(1)} ℃`
                  : overview.totalMedicineCount > 0
                    ? `用药 ${overview.totalMedicineCount} 次`
                    : '平稳'}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {overview.totalMedicineCount > 0
                ? `本周期共记录用药 ${overview.totalMedicineCount} 次`
                : overview.maxTempInPeriod !== null
                  ? '本周期暂无用药记录'
                  : '本周期暂无测温或用药记录'}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* 喂养多维分析主卡：奶量结构 / 亲喂时长与侧别 / 喂养次数与辅食 */}
      <InsightChartCard
        title={feedingCardMeta.title}
        description={feedingCardMeta.desc}
        icon={<Milk className="size-4 text-feeding" strokeWidth={1.8} />}
        exportSubtitle={babyContextSubtitle}
        exportFilenameBase={`${filenamePrefix}-${feedingCardMeta.title}`}
        exportLegend={feedingCardMeta.legend}
        isLoading={trendsQuery.isLoading}
        isError={trendsQuery.isError}
        errorMessage={trendsQuery.error instanceof Error ? trendsQuery.error.message : '喂养趋势加载失败'}
        onRetry={() => void trendsQuery.refetch()}
        isEmpty={feedingCardMeta.isEmpty}
        emptyTitle={feedingCardMeta.emptyTitle}
        emptyDescription={feedingCardMeta.emptyDesc}
        emptyAction={
          <Button type="button" size="sm" variant="outline" onClick={() => openCreate('feeding')}>
            <PlusIcon className="size-3.5" />
            记一笔喂养
          </Button>
        }
        headerExtra={
          <Tabs
            value={feedingTab}
            onValueChange={(val) => {
              const v = String(val);
              setFeedingTab(v === 'direct' || v === 'counts' ? v : 'milk');
            }}
          >
            <TabsList>
              <TabsTrigger value="milk">奶量结构</TabsTrigger>
              <TabsTrigger value="direct">亲喂时长</TabsTrigger>
              <TabsTrigger value="counts">喂养次数</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        footer={
          feedingTab === 'milk' ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-feeding" />
                  配方奶（有记录日均{' '}
                  <span className="font-medium text-foreground tabular-nums">{overview.avgFormulaML} ml</span>）
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-primary" />
                  瓶喂母乳（有记录日均{' '}
                  <span className="font-medium text-foreground tabular-nums">{overview.avgBottleBreastML} ml</span>）
                </span>
              </div>
              {overview.hasDirectBreastData ? (
                <span className="tabular-nums">同时有亲喂日均 {overview.avgDirectBreastMin} 分钟</span>
              ) : null}
            </div>
          ) : feedingTab === 'direct' && overview.breastSideTotal > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>本周期亲喂侧别分布（共 {overview.breastSideTotal} 次）：</span>
              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                <Badge variant="outline">
                  左侧 {overview.breastSide.leftCount} 次（{overview.breastSide.leftPct}%）
                </Badge>
                <Badge variant="outline">
                  右侧 {overview.breastSide.rightCount} 次（{overview.breastSide.rightPct}%）
                </Badge>
                {overview.breastSide.bothCount > 0 ? (
                  <Badge variant="outline">
                    双侧 {overview.breastSide.bothCount} 次（{overview.breastSide.bothPct}%）
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : feedingTab === 'counts' ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-feeding" />
                  配方奶
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-primary" />
                  瓶喂母乳
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-health" />
                  亲喂
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-care" />
                  辅食
                </span>
              </div>
              {overview.totalSolidCount > 0 ? (
                <span className="tabular-nums">
                  辅食共 {overview.totalSolidCount} 次
                  {overview.solidAcceptance.total > 0
                    ? `（${ACCEPTANCE_LABELS.like} ${overview.solidAcceptance.likeCount} · ${ACCEPTANCE_LABELS.neutral} ${overview.solidAcceptance.neutralCount} · ${ACCEPTANCE_LABELS.dislike} ${overview.solidAcceptance.dislikeCount}）`
                    : ''}
                </span>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {feedingTab === 'milk' ? (
          <ChartContainer config={MILK_CHART_CONFIG} className="aspect-auto h-64 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={xTickGap} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<FeedingTooltip mode="milk" />} />
              <Bar
                dataKey="formula_ml"
                stackId="milk"
                fill="var(--feeding)"
                radius={[0, 0, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
              <Bar
                dataKey="bottle_breast_ml"
                stackId="milk"
                fill="var(--primary)"
                radius={barRadius}
                maxBarSize={28}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        ) : feedingTab === 'direct' ? (
          <ChartContainer config={DIRECT_CHART_CONFIG} className="aspect-auto h-64 w-full">
            <AreaChart data={daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="insightsDirectBreastFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--feeding)" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="var(--feeding)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={xTickGap} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<FeedingTooltip mode="direct" />} />
              <Area
                type="monotone"
                dataKey="direct_breast_min"
                stroke="var(--feeding)"
                strokeWidth={2.2}
                fill="url(#insightsDirectBreastFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <ChartContainer config={COUNTS_CHART_CONFIG} className="aspect-auto h-64 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={xTickGap} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} tickMargin={8} />
              <ChartTooltip content={<FeedingTooltip mode="counts" />} />
              <Bar
                dataKey="formula_count"
                stackId="cnt"
                fill="var(--feeding)"
                maxBarSize={28}
                isAnimationActive={false}
              />
              <Bar
                dataKey="bottle_breast_count"
                stackId="cnt"
                fill="var(--primary)"
                maxBarSize={28}
                isAnimationActive={false}
              />
              <Bar
                dataKey="direct_breast_count"
                stackId="cnt"
                fill="var(--health)"
                maxBarSize={28}
                isAnimationActive={false}
              />
              <Bar
                dataKey="solid_count"
                stackId="cnt"
                fill="var(--care)"
                radius={barRadius}
                maxBarSize={28}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        )}
      </InsightChartCard>

      {/* 睡眠昼夜结构 + 排泄趋势双栏 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-2">
        <InsightChartCard
          title="睡眠昼夜结构"
          description="区分夜间整觉与白天小睡时长（小时）"
          icon={<MoonStar className="size-4 text-sleep" strokeWidth={1.8} />}
          exportSubtitle={babyContextSubtitle}
          exportFilenameBase={`${filenamePrefix}-睡眠昼夜趋势`}
          exportLegend={SLEEP_LEGEND}
          isLoading={trendsQuery.isLoading}
          isError={trendsQuery.isError}
          errorMessage={trendsQuery.error instanceof Error ? trendsQuery.error.message : '睡眠趋势加载失败'}
          onRetry={() => void trendsQuery.refetch()}
          isEmpty={!overview.hasSleepData}
          emptyTitle={`近 ${days} 天暂无睡眠记录`}
          emptyDescription="记录入睡与醒来时间后，这里会拆解夜觉与白天小睡变化。"
          emptyAction={
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('sleep')}>
              <PlusIcon className="size-3.5" />
              记一笔睡眠
            </Button>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-sleep" />
                  夜间睡眠（日均{' '}
                  <span className="font-medium text-foreground tabular-nums">{overview.avgNightHours} h</span>）
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-feeding" />
                  白天小睡
                </span>
              </div>
              <span className="tabular-nums">
                {[
                  overview.longestNightMin > 0 ? `最长夜觉 ${formatDurationMin(overview.longestNightMin)}` : '',
                  overview.avgNapMin > 0 ? `单次小睡均长 ${formatDurationMin(overview.avgNapMin)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          }
        >
          <ChartContainer config={SLEEP_CHART_CONFIG} className="aspect-auto h-60 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={xTickGap} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<SleepTooltip />} />
              <Bar
                dataKey="night_hours"
                stackId="sleep"
                fill="var(--sleep)"
                maxBarSize={26}
                isAnimationActive={false}
              />
              <Bar
                dataKey="nap_hours"
                stackId="sleep"
                fill="var(--feeding)"
                radius={barRadius}
                maxBarSize={26}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </InsightChartCard>

        <InsightChartCard
          title="排尿与排便趋势"
          description="追踪每日嘘嘘与便便次数变化（次）"
          icon={<Baby className="size-4 text-care" strokeWidth={1.8} />}
          exportSubtitle={babyContextSubtitle}
          exportFilenameBase={`${filenamePrefix}-排尿排便趋势`}
          exportLegend={CARE_LEGEND}
          isLoading={trendsQuery.isLoading}
          isError={trendsQuery.isError}
          errorMessage={trendsQuery.error instanceof Error ? trendsQuery.error.message : '护理趋势加载失败'}
          onRetry={() => void trendsQuery.refetch()}
          isEmpty={!overview.hasCareData}
          emptyTitle={`近 ${days} 天暂无排泄记录`}
          emptyDescription="记录尿布嘘嘘与便便后，这里将自动统计每日频次趋势。"
          emptyAction={
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('care', 'diaper')}>
              <PlusIcon className="size-3.5" />
              记一笔换尿布
            </Button>
          }
          footer={
            <div className="space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-info" />
                    嘘嘘（日均{' '}
                    <span className="font-medium text-foreground tabular-nums">{overview.avgPeeCount} 次</span>）
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-care" />
                    便便（日均{' '}
                    <span className="font-medium text-foreground tabular-nums">{overview.avgPoopCount} 次</span>）
                  </span>
                </div>
                {overview.totalBathCount > 0 ? (
                  <span className="tabular-nums">本周期洗澡 {overview.totalBathCount} 次</span>
                ) : null}
              </div>
              {overview.stoolNotice ? (
                <p className="rounded-lg bg-warning-soft/75 px-2.5 py-1.5 text-warning-soft-foreground">
                  {overview.stoolNotice}
                </p>
              ) : null}
            </div>
          }
        >
          <ChartContainer config={CARE_CHART_CONFIG} className="aspect-auto h-60 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={xTickGap} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} tickMargin={8} />
              <ChartTooltip content={<CareTooltip />} />
              <Bar
                dataKey="pee_count"
                fill="var(--info)"
                radius={barRadius}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Bar
                dataKey="poop_count"
                fill="var(--care)"
                radius={barRadius}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </InsightChartCard>
      </div>

      {/* 底部双栏：按需体温趋势 + 照护时段节律 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-2">
        <InsightChartCard
          title="体温与用药观察"
          description="展示每日最高体温走势（37.3℃ 低热 / 38.5℃ 高热参考线）"
          icon={<Thermometer className="size-4 text-health" strokeWidth={1.8} />}
          exportSubtitle={babyContextSubtitle}
          exportFilenameBase={`${filenamePrefix}-体温观察趋势`}
          exportLegend={HEALTH_LEGEND}
          isLoading={trendsQuery.isLoading}
          isError={trendsQuery.isError}
          errorMessage={trendsQuery.error instanceof Error ? trendsQuery.error.message : '健康趋势加载失败'}
          onRetry={() => void trendsQuery.refetch()}
          isEmpty={!overview.hasTemperatureData}
          emptyTitle={overview.totalMedicineCount > 0 ? `近 ${days} 天暂无体温记录` : `近 ${days} 天宝宝体温平稳无记录`}
          emptyDescription={
            overview.totalMedicineCount > 0
              ? `本周期已记录用药 ${overview.totalMedicineCount} 次；记录体温后可在此查看发热波动曲线。`
              : '发热或接种疫苗后记录体温，这里会自动绘制带参考线的体温曲线，便于就医出示。'
          }
          emptyAction={
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('health', 'temperature')}>
              <PlusIcon className="size-3.5" />
              记一笔体温
            </Button>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-health" />
                  当日最高体温
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 border-t border-dashed border-warning" />
                  37.3℃
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 border-t border-dashed border-destructive" />
                  38.5℃
                </span>
              </div>
              {overview.totalMedicineCount > 0 ? (
                <span className="tabular-nums">周期用药共 {overview.totalMedicineCount} 次</span>
              ) : null}
            </div>
          }
        >
          <ChartContainer config={HEALTH_CHART_CONFIG} className="aspect-auto h-60 w-full">
            <ComposedChart data={daily} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={xTickGap} />
              <YAxis domain={[35.5, 40.5]} tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<HealthTooltip />} />
              <ReferenceLine y={37.3} stroke="var(--warning)" strokeDasharray="4 4" strokeWidth={1.2} />
              <ReferenceLine y={38.5} stroke="var(--destructive)" strokeDasharray="4 4" strokeWidth={1.2} />
              <Line
                type="monotone"
                dataKey="max_temp_c"
                stroke="var(--health)"
                strokeWidth={2.2}
                connectNulls
                dot={{ r: 3.5, fill: 'var(--health)', stroke: 'var(--card)', strokeWidth: 2 }}
                activeDot={{ r: 5, fill: 'var(--health)', stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        </InsightChartCard>

        <InsightChartCard
          title="全天照护节律"
          description={`近 ${days} 天各时段照护活跃频次分布`}
          icon={<Clock3 className="size-4 text-primary" strokeWidth={1.8} />}
          exportSubtitle={babyContextSubtitle}
          exportFilenameBase={`${filenamePrefix}-全天照护节律`}
          exportLegend={SLOT_LEGEND}
          isLoading={trendsQuery.isLoading}
          isError={trendsQuery.isError}
          errorMessage={trendsQuery.error instanceof Error ? trendsQuery.error.message : '照护节律加载失败'}
          onRetry={() => void trendsQuery.refetch()}
          isEmpty={!overview.hasSlotData}
          emptyTitle="暂无时段分布"
          emptyDescription="记下几笔日常后这里会呈现宝宝一天中最活跃的照护时段。"
          footer={
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BarChart3 className="size-3.5 text-primary" />
              <span>清晨 05–08 · 上午 09–11 · 下午 12–17 · 傍晚 18–20 · 夜间 21–04</span>
            </div>
          }
        >
          <ChartContainer config={SLOT_CHART_CONFIG} className="aspect-auto h-60 w-full">
            <BarChart data={trends?.slots ?? []} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="slot" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent unit="次" />} />
              <Bar
                dataKey="count"
                fill="var(--sleep)"
                radius={[8, 8, 2, 2]}
                maxBarSize={36}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </InsightChartCard>
      </div>
    </div>
  );
}
