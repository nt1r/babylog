import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ArrowUpRight, Baby, Bath, Droplets, HeartPulse, Milk, MoonStar, Sparkles, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { LittleMoments } from '@/components/brand/little-moments';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useBabyProfileQuery } from '@/lib/baby';
import { useDashboardSummaryQuery, useDashboardTrendsQuery } from '@/lib/dashboard';
import {
  createCareRecord,
  createFeedingRecord,
  deleteCareRecord,
  deleteFeedingRecord,
  getTemperatureSeverity,
  invalidateAllRecordQueries,
  useSmartDefaultsQuery,
} from '@/lib/records';
import { formatBabyAge, formatHoursFromMin, formatLocalTimeFromISO, formatTimeSince } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
});

const trendChartConfig: ChartConfig = {
  feeding_ml: {
    label: '每日奶量',
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
    description: '母乳、配方奶或辅食',
    icon: Milk,
    cardClass: 'bg-feeding-soft/50 hover:border-feeding',
    iconClass: 'bg-feeding-soft text-feeding-soft-foreground',
  },
  {
    category: 'sleep' as const,
    title: '记一笔睡眠',
    description: '白天小睡与夜间整觉',
    icon: MoonStar,
    cardClass: 'bg-sleep-soft/50 hover:border-sleep',
    iconClass: 'bg-sleep-soft text-sleep-soft-foreground',
  },
  {
    category: 'health' as const,
    title: '记一笔健康',
    description: '体温、用药、身高体重与长牙',
    icon: HeartPulse,
    cardClass: 'bg-health-soft/50 hover:border-health',
    iconClass: 'bg-health-soft text-health-soft-foreground',
  },
  {
    category: 'care' as const,
    title: '记一笔护理',
    description: '排便、换尿布与洗澡',
    icon: Baby,
    cardClass: 'bg-care-soft/50 hover:border-care',
    iconClass: 'bg-care-soft text-care-soft-foreground',
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

function DashboardPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const [trendMetric, setTrendMetric] = useState<'feeding_ml' | 'sleep_hours'>('feeding_ml');
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
  const lastMilkML = defaultsQuery.data?.feeding.last_milk_ml ?? 90;

  const todayLabel = format(now, 'M月d日 EEEE', { locale: zhCN });
  const greeting = getTimeGreeting(now);
  const ageInfo = baby ? formatBabyAge(baby.birth_date, now) : null;

  const isFeedingTrend = trendMetric === 'feeding_ml';

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
      : '今日还没有喂养记录'
    : '母乳、奶粉与辅食';

  const sleepValue = summary ? formatHoursFromMin(summary.sleep.total_min) : '—';
  const sleepSub = summary
    ? `小睡 ${summary.sleep.nap_count} 次 · 夜觉 ${formatHoursFromMin(summary.sleep.night_min)}`
    : '小睡与夜觉时长';

  const latestTemp = summary?.health.latest_temp_c ?? null;
  const tempSeverity = latestTemp !== null ? getTemperatureSeverity(latestTemp) : null;
  const healthValue = latestTemp !== null ? `${latestTemp.toFixed(1)} ℃` : '— ℃';
  const healthSub = summary?.health.latest_temp_at
    ? `${tempSeverity?.label ?? ''} · ${formatTimeSince(summary.health.latest_temp_at, now)}`
    : '体温、用药与生长';

  const careValue = summary ? `${summary.care.total_count} 次` : '—';
  const careSub = summary
    ? summary.care.last_diaper_at
      ? `嘘嘘 ${summary.care.pee_count} · 便便 ${summary.care.poop_count} · 上次 ${formatTimeSince(summary.care.last_diaper_at, now)}`
      : `嘘嘘 ${summary.care.pee_count} · 便便 ${summary.care.poop_count}`
    : '排便、尿布与洗澡';

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

  async function handleOneTap(kind: 'pee' | 'poop' | 'formula' | 'bath') {
    if (quickBusyKey) return;
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
            onClick: async () => {
              await deleteFeedingRecord(created.id);
              invalidateAllRecordQueries(queryClient);
              toast.info('已撤销刚才的喂养记录');
            },
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
            onClick: async () => {
              await deleteCareRecord(created.id);
              invalidateAllRecordQueries(queryClient);
              toast.info('已撤销刚才的护理记录');
            },
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
            onClick: async () => {
              await deleteCareRecord(created.id);
              invalidateAllRecordQueries(queryClient);
              toast.info('已撤销刚才的护理记录');
            },
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
            onClick: async () => {
              await deleteCareRecord(created.id);
              invalidateAllRecordQueries(queryClient);
              toast.info('已撤销刚才的洗澡记录');
            },
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
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting}，{user?.username ?? '奶爸'}
          </h1>
          <Badge variant="secondary" className="font-normal">
            {todayLabel}
          </Badge>
          {baby && ageInfo ? (
            <Badge variant="outline" className="font-normal text-primary">
              {baby.nickname} · {ageInfo.daysLabel}（{ageInfo.ageLabel}）
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {baby
            ? `${baby.nickname}今天的喂养、睡眠、健康与护理都在这里。`
            : '宝宝今天的喂养、睡眠、健康与护理都在这里。'}
        </p>
      </div>

      {/* 4 列核心指标概览 */}
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

      {/* 2:1 喂养/睡眠趋势与时段分布图 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-3">
        <Card className="@4xl/main:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle>近 7 日成长趋势</CardTitle>
              <CardDescription>{isFeedingTrend ? '每日奶量变化（ml）' : '每日睡眠时长变化（小时）'}</CardDescription>
            </div>
            <Tabs
              value={trendMetric}
              onValueChange={(value) => setTrendMetric(value === 'sleep_hours' ? 'sleep_hours' : 'feeding_ml')}
            >
              <TabsList>
                <TabsTrigger value="feeding_ml">奶量</TabsTrigger>
                <TabsTrigger value="sleep_hours">睡眠</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {trendsQuery.isLoading ? (
              <Skeleton className="h-60 w-full rounded-xl" />
            ) : (
              <ChartContainer config={trendChartConfig} className="aspect-auto h-60 w-full">
                <AreaChart data={trends?.daily ?? []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendMetricFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={isFeedingTrend ? 'var(--feeding)' : 'var(--sleep)'}
                        stopOpacity={0.32}
                      />
                      <stop
                        offset="95%"
                        stopColor={isFeedingTrend ? 'var(--feeding)' : 'var(--sleep)'}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent unit={isFeedingTrend ? 'ml' : 'h'} />} />
                  <Area
                    type="monotone"
                    dataKey={trendMetric}
                    stroke={isFeedingTrend ? 'var(--feeding)' : 'var(--sleep)'}
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
            <CardDescription>近 7 日各时段的照护频次分布</CardDescription>
          </CardHeader>
          <CardContent>
            {trendsQuery.isLoading ? (
              <Skeleton className="h-60 w-full rounded-xl" />
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

      {/* 底部极速一键直记 + 快捷录入入口与品牌绘本卡片 */}
      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-3">
        <Card className="@4xl/main:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              快速记录
            </CardTitle>
            <CardDescription>高频小事一键直记（误点可 5 秒内撤销），详细记录点下方分类。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Zap className="size-3.5 text-primary" />
                一键直记（自动带出当前时间）
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={quickBusyKey !== null}
                  onClick={() => void handleOneTap('formula')}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-feeding/60 bg-feeding-soft/60 px-3.5 py-2 text-xs font-medium text-feeding-soft-foreground transition-colors hover:bg-feeding-soft disabled:opacity-60"
                >
                  <Milk className="size-3.5" />
                  <span className="tabular-nums">再来一顿 {lastMilkML} ml</span>
                </button>
                <button
                  type="button"
                  disabled={quickBusyKey !== null}
                  onClick={() => void handleOneTap('pee')}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-care/60 bg-care-soft/60 px-3.5 py-2 text-xs font-medium text-care-soft-foreground transition-colors hover:bg-care-soft disabled:opacity-60"
                >
                  <Droplets className="size-3.5" />
                  嘘嘘
                </button>
                <button
                  type="button"
                  disabled={quickBusyKey !== null}
                  onClick={() => void handleOneTap('poop')}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-care/60 bg-care-soft/60 px-3.5 py-2 text-xs font-medium text-care-soft-foreground transition-colors hover:bg-care-soft disabled:opacity-60"
                >
                  <Baby className="size-3.5" />
                  便便正常
                </button>
                <button
                  type="button"
                  disabled={quickBusyKey !== null}
                  onClick={() => void handleOneTap('bath')}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-secondary/70 px-3.5 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                >
                  <Bath className="size-3.5" />
                  洗澡
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {QUICK_RECORD_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.category}
                    type="button"
                    onClick={() => openQuickRecord(action.category)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border border-border/80 p-3.5 text-left transition-colors',
                      action.cardClass,
                    )}
                  >
                    <span
                      className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', action.iconClass)}
                    >
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{action.title}</p>
                      <p className="text-xs text-muted-foreground">{action.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="justify-between">
          <CardHeader>
            <CardTitle>小小的日常，大大的成长</CardTitle>
            <CardDescription>陪你留住宝宝成长的每一个温暖瞬间。</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pt-1">
            <LittleMoments className="max-w-52" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
