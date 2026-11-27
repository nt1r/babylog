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
import { CareRhythmBarChart, ChartCard, ChartTooltipCard, ChartTooltipRow } from '@/components/chart-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { SegmentedControl } from '@/components/ui/choice-controls';
import { InfoPopover } from '@/components/ui/info-popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveBaby } from '@/lib/baby';
import { type DashboardTrends, useDashboardTrendsQuery } from '@/lib/dashboard';
import {
  buildInsightsViewModel,
  type FeedingChartTab,
  INSIGHT_RANGE_OPTIONS,
  INSIGHTS_CHART_SERIES,
  type InsightRangeDays,
} from '@/lib/insights';
import { ACCEPTANCE_LABELS } from '@/lib/records';
import { formatDurationMin } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useOverlayStore } from '@/stores/overlays';

export const Route = createFileRoute('/_app/insights')({
  component: InsightsPage,
});

type DailyPoint = DashboardTrends['daily'][number];

const KPI_ICON_META = {
  feeding: { Icon: Milk, badgeClass: 'bg-feeding-soft text-feeding-soft-foreground' },
  sleep: { Icon: MoonStar, badgeClass: 'bg-sleep-soft text-sleep-soft-foreground' },
  care: { Icon: Baby, badgeClass: 'bg-care-soft text-care-soft-foreground' },
  health: { Icon: HeartPulse, badgeClass: 'bg-health-soft text-health-soft-foreground' },
} as const;

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
    <ChartTooltipCard title={p.date} minWidthClass="min-w-44">
      {mode === 'milk' ? (
        <>
          <ChartTooltipRow label="总奶量" value={`${p.feeding_ml} ml`} emphasize />
          <ChartTooltipRow
            label="配方奶"
            value={`${p.formula_ml} ml（${p.formula_count} 次）`}
            swatchClass="bg-feeding"
            mutedValue
          />
          <ChartTooltipRow
            label="瓶喂母乳"
            value={`${p.bottle_breast_ml} ml（${p.bottle_breast_count} 次）`}
            swatchClass="bg-primary"
            mutedValue
          />
          {p.direct_breast_count > 0 ? (
            <ChartTooltipRow
              label="亲喂补充"
              value={`${p.direct_breast_count} 次 · ${formatDurationMin(p.direct_breast_min)}`}
              mutedValue
            />
          ) : null}
        </>
      ) : mode === 'direct' ? (
        <>
          <ChartTooltipRow label="亲喂时长" value={formatDurationMin(p.direct_breast_min)} swatchClass="bg-feeding" />
          <ChartTooltipRow label="亲喂次数" value={`${p.direct_breast_count} 次`} />
        </>
      ) : (
        <>
          <ChartTooltipRow label="当日总计" value={`${p.feeding_count} 次`} emphasize />
          <ChartTooltipRow label="配方奶" value={`${p.formula_count} 次`} swatchClass="bg-feeding" mutedValue />
          <ChartTooltipRow label="瓶喂母乳" value={`${p.bottle_breast_count} 次`} swatchClass="bg-primary" mutedValue />
          <ChartTooltipRow label="亲喂" value={`${p.direct_breast_count} 次`} swatchClass="bg-health" mutedValue />
          <ChartTooltipRow label="辅食" value={`${p.solid_count} 次`} swatchClass="bg-care" mutedValue />
        </>
      )}
    </ChartTooltipCard>
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
    <ChartTooltipCard title={p.date}>
      <ChartTooltipRow label="总睡眠" value={`${p.sleep_hours} 小时`} emphasize />
      <ChartTooltipRow label="夜间睡眠" value={`${p.night_hours} 小时`} swatchClass="bg-sleep" mutedValue />
      <ChartTooltipRow
        label="白天小睡"
        value={`${p.nap_hours} 小时（${p.nap_count} 次）`}
        swatchClass="bg-feeding"
        mutedValue
      />
    </ChartTooltipCard>
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
    <ChartTooltipCard title={p.date} minWidthClass="min-w-36">
      <ChartTooltipRow label="嘘嘘" value={`${p.pee_count} 次`} swatchClass="bg-info" />
      <ChartTooltipRow label="便便" value={`${p.poop_count} 次`} swatchClass="bg-care" />
      {p.bath_count > 0 ? <ChartTooltipRow label="洗澡" value={`${p.bath_count} 次`} mutedValue /> : null}
    </ChartTooltipCard>
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
    <ChartTooltipCard title={p.date}>
      <ChartTooltipRow
        label="最高体温"
        value={p.max_temp_c !== null ? `${p.max_temp_c.toFixed(1)} ℃` : '未测温'}
        swatchClass="bg-health"
      />
      <ChartTooltipRow label="当日用药" value={`${p.medicine_count} 次`} />
    </ChartTooltipCard>
  );
}

function InsightsPage() {
  const [days, setDays] = useState<InsightRangeDays>(30);
  const [feedingTab, setFeedingTab] = useState<FeedingChartTab>('milk');

  const { activeBaby } = useActiveBaby();
  const openCreate = useOverlayStore((s) => s.openQuickCreate);
  const openExport = useOverlayStore((s) => s.openExport);
  const trendsQuery = useDashboardTrendsQuery(days);

  const trends = trendsQuery.data;
  const daily = trends?.daily ?? [];
  const vm = useMemo(
    () => buildInsightsViewModel(trends, activeBaby, days, feedingTab),
    [trends, activeBaby, days, feedingTab],
  );

  const queryErrorText = trendsQuery.error instanceof Error ? trendsQuery.error.message : undefined;
  const handleRetry = () => void trendsQuery.refetch();

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
          <p className="text-xs text-muted-foreground tabular-nums">{vm.headerSubtitle}</p>
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
        {vm.kpiCards.map((card) => {
          const { Icon, badgeClass } = KPI_ICON_META[card.key];
          return (
            <Card
              key={card.key}
              className="h-full gap-2.5 [--card-spacing:--spacing(3.5)] sm:gap-3 sm:[--card-spacing:--spacing(5)]"
            >
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardDescription className="truncate text-[13px] font-medium text-muted-foreground sm:text-sm">
                  {card.label}
                </CardDescription>
                <span
                  className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-9', badgeClass)}
                >
                  <Icon className="size-4 sm:size-4.5" strokeWidth={1.8} />
                </span>
              </CardHeader>
              <CardContent className="space-y-1 sm:space-y-1.5">
                {trendsQuery.isLoading ? (
                  <Skeleton className="h-7 w-20 rounded-lg sm:h-8 sm:w-24" />
                ) : (
                  <p className="truncate text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-2xl">
                    {card.value}
                  </p>
                )}
                <p className="truncate text-xs text-muted-foreground tabular-nums">{card.sub}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* 喂养多维分析主卡：奶量结构 / 亲喂时长与侧别 / 喂养次数与辅食 */}
      <ChartCard
        title={vm.feedingCard.title}
        description={vm.feedingCard.description}
        icon={<Milk className="size-4 text-feeding" strokeWidth={1.8} />}
        exportSpec={{
          subtitle: vm.exportSubtitle,
          filenameBase: `${vm.filenamePrefix}-${vm.feedingCard.title}`,
          legend: vm.feedingCard.series.exportLegend,
        }}
        status={{
          isLoading: trendsQuery.isLoading,
          isError: trendsQuery.isError,
          errorMessage: queryErrorText ?? '喂养趋势加载失败',
          onRetry: handleRetry,
        }}
        empty={{
          isEmpty: vm.feedingCard.isEmpty,
          title: vm.feedingCard.emptyTitle,
          description: vm.feedingCard.emptyDescription,
          action: (
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('feeding')}>
              <PlusIcon className="size-3.5" />
              记一笔喂养
            </Button>
          ),
        }}
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
                  <span className="font-medium text-foreground tabular-nums">{vm.feedingStats.avgFormulaML} ml</span>）
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-primary" />
                  瓶喂母乳（有记录日均{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {vm.feedingStats.avgBottleBreastML} ml
                  </span>
                  ）
                </span>
              </div>
              {vm.feedingStats.hasDirectBreastData ? (
                <span className="tabular-nums">同时有亲喂日均 {vm.feedingStats.avgDirectBreastMin} 分钟</span>
              ) : null}
            </div>
          ) : feedingTab === 'direct' && vm.feedingStats.breastSideTotal > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>本周期亲喂侧别分布（共 {vm.feedingStats.breastSideTotal} 次）：</span>
              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                <Badge variant="outline">
                  左侧 {vm.feedingStats.breastSide.leftCount} 次（{vm.feedingStats.breastSide.leftPct}%）
                </Badge>
                <Badge variant="outline">
                  右侧 {vm.feedingStats.breastSide.rightCount} 次（{vm.feedingStats.breastSide.rightPct}%）
                </Badge>
                {vm.feedingStats.breastSide.bothCount > 0 ? (
                  <Badge variant="outline">
                    双侧 {vm.feedingStats.breastSide.bothCount} 次（{vm.feedingStats.breastSide.bothPct}%）
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : feedingTab === 'counts' ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                {INSIGHTS_CHART_SERIES.feedingCounts.items.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1.5">
                    <span className={cn('size-2.5 rounded-xs', item.swatchClass)} />
                    {item.label}
                  </span>
                ))}
              </div>
              {vm.feedingStats.totalSolidCount > 0 ? (
                <span className="tabular-nums">
                  辅食共 {vm.feedingStats.totalSolidCount} 次
                  {vm.feedingStats.solidAcceptance.total > 0
                    ? `（${ACCEPTANCE_LABELS.like} ${vm.feedingStats.solidAcceptance.likeCount} · ${ACCEPTANCE_LABELS.neutral} ${vm.feedingStats.solidAcceptance.neutralCount} · ${ACCEPTANCE_LABELS.dislike} ${vm.feedingStats.solidAcceptance.dislikeCount}）`
                    : ''}
                </span>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {feedingTab === 'milk' ? (
          <ChartContainer config={INSIGHTS_CHART_SERIES.feedingMilk.config} className="aspect-auto h-64 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={vm.xTickGap} />
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
                radius={vm.barRadius}
                maxBarSize={28}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        ) : feedingTab === 'direct' ? (
          <ChartContainer config={INSIGHTS_CHART_SERIES.feedingDirect.config} className="aspect-auto h-64 w-full">
            <AreaChart data={daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="insightsDirectBreastFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--feeding)" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="var(--feeding)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={vm.xTickGap} />
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
          <ChartContainer config={INSIGHTS_CHART_SERIES.feedingCounts.config} className="aspect-auto h-64 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={vm.xTickGap} />
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
                radius={vm.barRadius}
                maxBarSize={28}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        )}
      </ChartCard>

      {/* 睡眠昼夜结构 + 排泄趋势双栏 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-2">
        <ChartCard
          title="睡眠昼夜结构"
          description="区分夜间整觉与白天小睡时长（小时）"
          icon={<MoonStar className="size-4 text-sleep" strokeWidth={1.8} />}
          exportSpec={{
            subtitle: vm.exportSubtitle,
            filenameBase: `${vm.filenamePrefix}-睡眠昼夜趋势`,
            legend: INSIGHTS_CHART_SERIES.sleep.exportLegend,
          }}
          status={{
            isLoading: trendsQuery.isLoading,
            isError: trendsQuery.isError,
            errorMessage: queryErrorText ?? '睡眠趋势加载失败',
            onRetry: handleRetry,
          }}
          empty={{
            isEmpty: vm.sleepCard.isEmpty,
            title: vm.sleepCard.emptyTitle,
            description: '记录入睡与醒来时间后，这里会拆解夜觉与白天小睡变化。',
            action: (
              <Button type="button" size="sm" variant="outline" onClick={() => openCreate('sleep')}>
                <PlusIcon className="size-3.5" />
                记一笔睡眠
              </Button>
            ),
          }}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-sleep" />
                  夜间睡眠（日均{' '}
                  <span className="font-medium text-foreground tabular-nums">{vm.sleepCard.avgNightHours} h</span>）
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-feeding" />
                  白天小睡
                </span>
              </div>
              {vm.sleepCard.summaryMeta ? <span className="tabular-nums">{vm.sleepCard.summaryMeta}</span> : null}
            </div>
          }
        >
          <ChartContainer config={INSIGHTS_CHART_SERIES.sleep.config} className="aspect-auto h-60 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={vm.xTickGap} />
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
                radius={vm.barRadius}
                maxBarSize={26}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="排尿与排便趋势"
          description="追踪每日嘘嘘与便便次数变化（次）"
          icon={<Baby className="size-4 text-care" strokeWidth={1.8} />}
          exportSpec={{
            subtitle: vm.exportSubtitle,
            filenameBase: `${vm.filenamePrefix}-排尿排便趋势`,
            legend: INSIGHTS_CHART_SERIES.care.exportLegend,
          }}
          status={{
            isLoading: trendsQuery.isLoading,
            isError: trendsQuery.isError,
            errorMessage: queryErrorText ?? '护理趋势加载失败',
            onRetry: handleRetry,
          }}
          empty={{
            isEmpty: vm.careCard.isEmpty,
            title: vm.careCard.emptyTitle,
            description: '记录尿布嘘嘘与便便后，这里将自动统计每日频次趋势。',
            action: (
              <Button type="button" size="sm" variant="outline" onClick={() => openCreate('care', 'diaper')}>
                <PlusIcon className="size-3.5" />
                记一笔换尿布
              </Button>
            ),
          }}
          footer={
            <div className="space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-info" />
                    嘘嘘（日均{' '}
                    <span className="font-medium text-foreground tabular-nums">{vm.careCard.avgPeeCount} 次</span>）
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-care" />
                    便便（日均{' '}
                    <span className="font-medium text-foreground tabular-nums">{vm.careCard.avgPoopCount} 次</span>）
                  </span>
                </div>
                {vm.careCard.totalBathCount > 0 ? (
                  <span className="tabular-nums">本周期洗澡 {vm.careCard.totalBathCount} 次</span>
                ) : null}
              </div>
              {vm.careCard.stoolNotice ? (
                <p className="rounded-lg bg-warning-soft/75 px-2.5 py-1.5 text-warning-soft-foreground">
                  {vm.careCard.stoolNotice}
                </p>
              ) : null}
            </div>
          }
        >
          <ChartContainer config={INSIGHTS_CHART_SERIES.care.config} className="aspect-auto h-60 w-full">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={vm.xTickGap} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} tickMargin={8} />
              <ChartTooltip content={<CareTooltip />} />
              <Bar
                dataKey="pee_count"
                fill="var(--info)"
                radius={vm.barRadius}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Bar
                dataKey="poop_count"
                fill="var(--care)"
                radius={vm.barRadius}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>

      {/* 底部双栏：按需体温趋势 + 照护时段节律 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-2">
        <ChartCard
          title="体温与用药观察"
          description="展示每日最高体温走势（37.3℃ 低热 / 38.5℃ 高热参考线）"
          icon={<Thermometer className="size-4 text-health" strokeWidth={1.8} />}
          exportSpec={{
            subtitle: vm.exportSubtitle,
            filenameBase: `${vm.filenamePrefix}-体温观察趋势`,
            legend: INSIGHTS_CHART_SERIES.health.exportLegend,
          }}
          status={{
            isLoading: trendsQuery.isLoading,
            isError: trendsQuery.isError,
            errorMessage: queryErrorText ?? '健康趋势加载失败',
            onRetry: handleRetry,
          }}
          empty={{
            isEmpty: vm.healthCard.isEmpty,
            title: vm.healthCard.emptyTitle,
            description: vm.healthCard.emptyDescription,
            action: (
              <Button type="button" size="sm" variant="outline" onClick={() => openCreate('health', 'temperature')}>
                <PlusIcon className="size-3.5" />
                记一笔体温
              </Button>
            ),
          }}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                {INSIGHTS_CHART_SERIES.health.items.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1.5">
                    {item.swatchStyle === 'dashed' ? (
                      <span className={cn('h-0.5 w-3 border-t border-dashed', item.swatchClass)} />
                    ) : (
                      <span className={cn('size-2.5 rounded-full', item.swatchClass)} />
                    )}
                    {item.label}
                  </span>
                ))}
              </div>
              {vm.healthCard.totalMedicineCount > 0 ? (
                <span className="tabular-nums">周期用药共 {vm.healthCard.totalMedicineCount} 次</span>
              ) : null}
            </div>
          }
        >
          <ChartContainer config={INSIGHTS_CHART_SERIES.health.config} className="aspect-auto h-60 w-full">
            <ComposedChart data={daily} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={vm.xTickGap} />
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
        </ChartCard>

        <ChartCard
          title="全天照护节律"
          description={`近 ${days} 天各时段照护活跃频次分布`}
          icon={<Clock3 className="size-4 text-primary" strokeWidth={1.8} />}
          exportSpec={{
            subtitle: vm.exportSubtitle,
            filenameBase: `${vm.filenamePrefix}-全天照护节律`,
            legend: INSIGHTS_CHART_SERIES.rhythm.exportLegend,
          }}
          status={{
            isLoading: trendsQuery.isLoading,
            isError: trendsQuery.isError,
            errorMessage: queryErrorText ?? '照护节律加载失败',
            onRetry: handleRetry,
          }}
          empty={{
            isEmpty: vm.rhythmCard.isEmpty,
            title: '暂无时段分布',
            description: '记下几笔日常后这里会呈现宝宝一天中最活跃的照护时段。',
          }}
          footer={
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BarChart3 className="size-3.5 text-primary" />
              <span>清晨 05–08 · 上午 09–11 · 下午 12–17 · 傍晚 18–20 · 夜间 21–04</span>
            </div>
          }
        >
          <CareRhythmBarChart slots={trends?.slots ?? []} />
        </ChartCard>
      </div>
    </div>
  );
}
