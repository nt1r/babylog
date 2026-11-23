import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  AlertCircle,
  ArrowUpRight,
  Baby,
  Bath,
  Droplets,
  HeartPulse,
  Milk,
  MoonStar,
  PlusIcon,
  RotateCw,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useBabyProfileQuery } from '@/lib/baby';
import { type DashboardTrends, useDashboardSummaryQuery, useDashboardTrendsQuery } from '@/lib/dashboard';
import {
  createCareRecord,
  createFeedingRecord,
  deleteCareRecord,
  deleteFeedingRecord,
  getTemperatureSeverity,
  invalidateAllRecordQueries,
  useSmartDefaultsQuery,
} from '@/lib/records';
import { formatBabyAge, formatDurationMin, formatLocalTimeFromISO, formatTimeSince } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
});

type DailyTrendPoint = DashboardTrends['daily'][number];

const trendChartConfig: ChartConfig = {
  feeding_ml: {
    label: '每日奶量',
    color: 'var(--feeding)',
  },
  direct_breast_min: {
    label: '每日亲喂',
    color: 'var(--feeding)',
  },
  sleep_hours: {
    label: '每日睡眠',
    color: 'var(--sleep)',
  },
};

const slotChartConfig: ChartConfig = {
  count: {
    label: '照护次数',
    color: 'var(--sleep)',
  },
};

const QUICK_RECORD_ACTIONS = [
  {
    category: 'feeding' as const,
    title: '记一笔喂养',
    icon: Milk,
    cardClass: 'bg-feeding-soft/45 hover:border-feeding',
    iconClass: 'bg-feeding-soft text-feeding-soft-foreground',
  },
  {
    category: 'sleep' as const,
    title: '记一笔睡眠',
    icon: MoonStar,
    cardClass: 'bg-sleep-soft/45 hover:border-sleep',
    iconClass: 'bg-sleep-soft text-sleep-soft-foreground',
  },
  {
    category: 'care' as const,
    title: '记一笔护理',
    icon: Baby,
    cardClass: 'bg-care-soft/45 hover:border-care',
    iconClass: 'bg-care-soft text-care-soft-foreground',
  },
  {
    category: 'health' as const,
    title: '记一笔健康',
    icon: HeartPulse,
    cardClass: 'bg-health-soft/45 hover:border-health',
    iconClass: 'bg-health-soft text-health-soft-foreground',
  },
] as const;

/** 根据当前时间返回温暖的问候语 */
function getTimeGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return '夜深了，辛苦啦';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

interface TrendTooltipProps {
  readonly active?: boolean;
  readonly label?: string | number;
  readonly payload?: ReadonlyArray<{ payload?: DailyTrendPoint }>;
  readonly tab: 'feeding' | 'sleep';
  readonly isDirectBreastMode: boolean;
}

/** 自定义趋势悬浮提示：亲喂与混合喂养场景同时清晰呈现奶量与亲喂时长/次数。 */
function DashboardTrendTooltip({ active, label, payload, tab, isDirectBreastMode }: TrendTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="grid min-w-40 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium text-foreground">
        {label}（{point.date.slice(5)}）
      </div>
      {tab === 'sleep' ? (
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-sleep" />
            每日睡眠
          </span>
          <span className="font-medium text-foreground tabular-nums">{point.sleep_hours} 小时</span>
        </div>
      ) : isDirectBreastMode ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full bg-feeding" />
              亲喂时长
            </span>
            <span className="font-medium text-foreground tabular-nums">
              {formatDurationMin(point.direct_breast_min)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>亲喂次数</span>
            <span className="font-medium text-foreground tabular-nums">{point.direct_breast_count} 次</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full bg-feeding" />
              每日奶量
            </span>
            <span className="font-medium text-foreground tabular-nums">{point.feeding_ml} ml</span>
          </div>
          {point.direct_breast_count > 0 ? (
            <div className="flex items-center justify-between gap-4 text-muted-foreground">
              <span>亲喂补充</span>
              <span className="font-medium text-foreground tabular-nums">
                {point.direct_breast_count} 次 · {formatDurationMin(point.direct_breast_min)}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const [trendTab, setTrendTab] = useState<'feeding' | 'sleep'>('feeding');
  const [quickBusyKey, setQuickBusyKey] = useState<string | null>(null);
  // 每分钟刷新一次本地时钟，确保「距上次喂奶/换尿布 X 分钟前」在数据无变更时也能实时跳动。
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const babyQuery = useBabyProfileQuery();
  const summaryQuery = useDashboardSummaryQuery();
  const trendsQuery = useDashboardTrendsQuery(7);
  const defaultsQuery = useSmartDefaultsQuery();

  const baby = babyQuery.data;
  const summary = summaryQuery.data;
  const trends = trendsQuery.data;
  const defaultsReady = !defaultsQuery.isLoading;
  const lastMilkML = defaultsQuery.data?.feeding.last_milk_ml ?? 90;

  const todayLabel = format(now, 'M月d日 EEEE', { locale: zhCN });
  const greeting = getTimeGreeting(now);
  const ageInfo = baby ? formatBabyAge(baby.birth_date, now) : null;

  const dailyTrends = trends?.daily ?? [];
  const hasBottleMilkTrend = dailyTrends.some((item) => item.feeding_ml > 0);
  const hasDirectBreastTrend = dailyTrends.some((item) => item.direct_breast_min > 0);
  const isDirectBreastMode = !hasBottleMilkTrend && hasDirectBreastTrend;
  const hasSleepTrend = dailyTrends.some((item) => item.sleep_hours > 0);
  const hasCurrentTrendData = trendTab === 'sleep' ? hasSleepTrend : hasBottleMilkTrend || hasDirectBreastTrend;
  const trendDataKey = trendTab === 'sleep' ? 'sleep_hours' : isDirectBreastMode ? 'direct_breast_min' : 'feeding_ml';
  const hasSlotData = (trends?.slots ?? []).some((item) => item.count > 0);

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

  const kpiCards = [
    {
      id: 'feeding',
      label: '今日喂养',
      value: feedingValue,
      sub: feedingSub,
      iconClass: 'bg-feeding-soft text-feeding-soft-foreground',
      icon: Milk,
      to: '/feeding' as const,
      alertTone: null as 'warning' | 'destructive' | null,
    },
    {
      id: 'sleep',
      label: '今日睡眠',
      value: sleepValue,
      sub: sleepSub,
      iconClass: 'bg-sleep-soft text-sleep-soft-foreground',
      icon: MoonStar,
      to: '/sleep' as const,
      alertTone: null as 'warning' | 'destructive' | null,
    },
    {
      id: 'health',
      label: '最近体温',
      value: healthValue,
      sub: healthSub,
      iconClass: 'bg-health-soft text-health-soft-foreground',
      icon: HeartPulse,
      to: '/health' as const,
      alertTone:
        tempSeverity && tempSeverity.level !== 'normal' ? (tempSeverity.level as 'warning' | 'destructive') : null,
    },
    {
      id: 'care',
      label: '今日护理',
      value: careValue,
      sub: careSub,
      iconClass: 'bg-care-soft text-care-soft-foreground',
      icon: Baby,
      to: '/care' as const,
      alertTone: null as 'warning' | 'destructive' | null,
    },
  ];

  async function undoRecord(action: () => Promise<void>, successTitle: string) {
    try {
      await action();
      invalidateAllRecordQueries(queryClient);
      toast.info(successTitle);
    } catch (cause) {
      toast.error('撤销失败', cause instanceof Error ? cause.message : '请前往记录页手动删除。');
    }
  }

  async function handleOneTap(kind: 'pee' | 'poop' | 'formula' | 'bath') {
    if (quickBusyKey) return;
    if (kind === 'formula' && !defaultsReady) return;
    setQuickBusyKey(kind);
    const recordedAt = new Date().toISOString();
    const timeText = formatLocalTimeFromISO(recordedAt);

    try {
      if (kind === 'formula') {
        const created = await createFeedingRecord({
          subtype: 'formula',
          amount_ml: lastMilkML,
          recorded_at: recordedAt,
          note: '',
        });
        invalidateAllRecordQueries(queryClient);
        toast.success(`已记录 · ${lastMilkML} ml 配方奶`, `记录时间 ${timeText}`, {
          action: {
            label: '撤销',
            onClick: () => undoRecord(() => deleteFeedingRecord(created.id), '已撤销刚才的喂养记录'),
          },
        });
      } else if (kind === 'pee') {
        const created = await createCareRecord({
          subtype: 'diaper',
          diaper_kind: 'pee',
          recorded_at: recordedAt,
          note: '',
        });
        invalidateAllRecordQueries(queryClient);
        toast.success('已记录 · 嘘嘘', `记录时间 ${timeText}`, {
          action: {
            label: '撤销',
            onClick: () => undoRecord(() => deleteCareRecord(created.id), '已撤销刚才的护理记录'),
          },
        });
      } else if (kind === 'poop') {
        const created = await createCareRecord({
          subtype: 'diaper',
          diaper_kind: 'poop',
          stool_consistency: 'soft',
          stool_color: 'yellow',
          recorded_at: recordedAt,
          note: '',
        });
        invalidateAllRecordQueries(queryClient);
        toast.success('已记录 · 便便正常', `记录时间 ${timeText}`, {
          action: {
            label: '撤销',
            onClick: () => undoRecord(() => deleteCareRecord(created.id), '已撤销刚才的护理记录'),
          },
        });
      } else {
        const created = await createCareRecord({
          subtype: 'bath',
          recorded_at: recordedAt,
          note: '',
        });
        invalidateAllRecordQueries(queryClient);
        toast.success('已记录 · 洗澡', `记录时间 ${timeText}`, {
          action: {
            label: '撤销',
            onClick: () => undoRecord(() => deleteCareRecord(created.id), '已撤销刚才的洗澡记录'),
          },
        });
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '快捷记录失败，请重试');
    } finally {
      setQuickBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      {/* 精简问候区 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{greeting}</h1>
        <Badge variant="secondary" className="font-normal">
          {todayLabel}
        </Badge>
        {baby && ageInfo ? (
          <Badge variant="outline" className="font-normal text-primary">
            {baby.nickname} · {ageInfo.daysLabel}（{ageInfo.ageLabel}）
          </Badge>
        ) : null}
      </div>

      {/* 首屏置顶：高频一键直记条 */}
      <section aria-label="一键直记" className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Zap className="size-3.5 text-primary" />
          一键直记
        </span>
        <button
          type="button"
          disabled={quickBusyKey !== null || !defaultsReady}
          onClick={() => void handleOneTap('formula')}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-feeding/60 bg-feeding-soft/60 px-3.5 text-xs font-medium text-feeding-soft-foreground transition-colors hover:bg-feeding-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quickBusyKey === 'formula' ? (
            <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
          ) : (
            <Milk className="size-3.5" />
          )}
          <span className="tabular-nums">{defaultsReady ? `再来一顿 ${lastMilkML} ml` : '加载惯用奶量…'}</span>
        </button>
        <button
          type="button"
          disabled={quickBusyKey !== null}
          onClick={() => void handleOneTap('pee')}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-care/60 bg-care-soft/60 px-3.5 text-xs font-medium text-care-soft-foreground transition-colors hover:bg-care-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quickBusyKey === 'pee' ? (
            <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
          ) : (
            <Droplets className="size-3.5" />
          )}
          嘘嘘
        </button>
        <button
          type="button"
          disabled={quickBusyKey !== null}
          onClick={() => void handleOneTap('poop')}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-care/60 bg-care-soft/60 px-3.5 text-xs font-medium text-care-soft-foreground transition-colors hover:bg-care-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quickBusyKey === 'poop' ? (
            <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
          ) : (
            <Baby className="size-3.5" />
          )}
          便便正常
        </button>
        <button
          type="button"
          disabled={quickBusyKey !== null}
          onClick={() => void handleOneTap('bath')}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-secondary/70 px-3.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quickBusyKey === 'bath' ? (
            <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
          ) : (
            <Bath className="size-3.5" />
          )}
          洗澡
        </button>
      </section>

      {/* 4 列核心指标概览 */}
      {summaryQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive-soft/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2.5 text-sm text-destructive-soft-foreground">
              <AlertCircle className="size-4 shrink-0" />
              <span>{summaryQuery.error instanceof Error ? summaryQuery.error.message : '今日数据加载失败'}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
              <RotateCw className="size-3.5" />
              重新加载
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-4">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.id} to={card.to} className="group block outline-none">
                <Card className="h-full gap-3 transition-all group-hover:border-primary/40 group-hover:shadow-xs group-focus-visible:ring-2 group-focus-visible:ring-ring">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                    <CardDescription className="font-medium text-muted-foreground">{card.label}</CardDescription>
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', card.iconClass)}>
                      <Icon className="size-4.5" strokeWidth={1.8} />
                    </span>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {summaryQuery.isLoading ? (
                      <Skeleton className="h-8 w-24 rounded-lg" />
                    ) : (
                      <p
                        className={cn(
                          'text-2xl font-semibold tracking-tight tabular-nums',
                          card.alertTone === 'destructive' && 'text-destructive',
                          card.alertTone === 'warning' && 'text-warning',
                        )}
                      >
                        {card.value}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate tabular-nums">{card.sub}</span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* 2:1 喂养/睡眠趋势与时段分布图 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-3">
        <Card className="@4xl/main:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle>近 7 日成长趋势</CardTitle>
              <CardDescription>
                {trendTab === 'sleep'
                  ? '每日睡眠时长（小时）'
                  : isDirectBreastMode
                    ? '每日亲喂时长（分钟）'
                    : '每日奶量（ml）'}
              </CardDescription>
            </div>
            <Tabs value={trendTab} onValueChange={(value) => setTrendTab(value === 'sleep' ? 'sleep' : 'feeding')}>
              <TabsList>
                <TabsTrigger value="feeding">喂养</TabsTrigger>
                <TabsTrigger value="sleep">睡眠</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {trendsQuery.isLoading ? (
              <Skeleton className="h-60 w-full rounded-xl" />
            ) : trendsQuery.isError ? (
              <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {trendsQuery.error instanceof Error ? trendsQuery.error.message : '趋势数据加载失败'}
                </p>
                <Button variant="outline" size="sm" onClick={() => void trendsQuery.refetch()}>
                  <RotateCw className="size-3.5" />
                  重新加载
                </Button>
              </div>
            ) : !hasCurrentTrendData ? (
              <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
                <p className="text-sm font-medium text-foreground">
                  {trendTab === 'sleep' ? '近 7 日还没有睡眠记录' : '近 7 日还没有喂养记录'}
                </p>
                <Button size="sm" variant="outline" onClick={() => openQuickRecord(trendTab)}>
                  <PlusIcon className="size-3.5" />
                  {trendTab === 'sleep' ? '记一笔睡眠' : '记一笔喂养'}
                </Button>
              </div>
            ) : (
              <ChartContainer config={trendChartConfig} className="aspect-auto h-60 w-full">
                <AreaChart data={dailyTrends} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendMetricFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={trendTab === 'feeding' ? 'var(--feeding)' : 'var(--sleep)'}
                        stopOpacity={0.32}
                      />
                      <stop
                        offset="95%"
                        stopColor={trendTab === 'feeding' ? 'var(--feeding)' : 'var(--sleep)'}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip
                    content={<DashboardTrendTooltip tab={trendTab} isDirectBreastMode={isDirectBreastMode} />}
                  />
                  <Area
                    type="monotone"
                    dataKey={trendDataKey}
                    stroke={trendTab === 'feeding' ? 'var(--feeding)' : 'var(--sleep)'}
                    strokeWidth={2.2}
                    fill="url(#trendMetricFill)"
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>每日照护节律</CardTitle>
            <CardDescription>近 7 日各时段照护次数</CardDescription>
          </CardHeader>
          <CardContent>
            {trendsQuery.isLoading ? (
              <Skeleton className="h-60 w-full rounded-xl" />
            ) : trendsQuery.isError ? (
              <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
                <p className="text-sm text-muted-foreground">节律分布加载失败</p>
                <Button variant="outline" size="sm" onClick={() => void trendsQuery.refetch()}>
                  <RotateCw className="size-3.5" />
                  重新加载
                </Button>
              </div>
            ) : !hasSlotData ? (
              <div className="flex h-60 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
                <p className="text-sm font-medium text-foreground">暂无时段分布</p>
                <p className="text-xs text-muted-foreground">记下几笔日常后这里会呈现宝宝的活跃节律</p>
              </div>
            ) : (
              <ChartContainer config={slotChartConfig} className="aspect-auto h-60 w-full">
                <BarChart data={trends?.slots ?? []} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="slot" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent unit="次" />} />
                  <Bar dataKey="count" fill="var(--sleep)" radius={[8, 8, 2, 2]} maxBarSize={32} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 紧凑四分类快捷录入入口（移除纯装饰绘本卡片） */}
      <div className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4">
        {QUICK_RECORD_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.category}
              type="button"
              onClick={() => openQuickRecord(action.category)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-2xl border border-border/80 px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                action.cardClass,
              )}
            >
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', action.iconClass)}>
                <Icon className="size-4.5" />
              </span>
              <span className="text-sm font-medium text-foreground">{action.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
