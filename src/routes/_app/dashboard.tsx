import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  AlertCircle,
  ArrowUpRight,
  Baby,
  Bath,
  Droplets,
  type LucideIcon,
  Milk,
  PlusIcon,
  RotateCw,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { FEEDING_BOUNDS } from '@/components/quick-record/codecs/feeding';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useBabyProfileQuery } from '@/lib/baby';
import { RECORD_CATEGORIES, RECORD_CATEGORY_META, type RecordCategory } from '@/lib/categories';
import {
  buildDashboardKpiCards,
  type DashboardTrends,
  type DashboardTrendTab,
  selectTrendView,
  useDashboardSummaryQuery,
  useDashboardTrendsQuery,
} from '@/lib/dashboard';
import {
  type SaveRecordRequest,
  useDeleteRecordMutation,
  useSaveRecordMutation,
  useSmartDefaultsQuery,
} from '@/lib/records';
import { formatBabyAge, formatDurationMin, formatLocalTimeFromISO } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useQuickRecordStore } from '@/stores/quick-record';

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
});

type DailyTrendPoint = DashboardTrends['daily'][number];
type OneTapKind = 'formula' | 'pee' | 'poop' | 'bath';

interface OneTapPreset {
  readonly kind: OneTapKind;
  readonly category: RecordCategory;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly buttonClass: string;
  readonly disabled?: boolean;
  readonly toastTitle: string;
  readonly undoToastTitle: string;
  readonly buildRequest: (recordedAt: string) => SaveRecordRequest;
}

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
  readonly tab: DashboardTrendTab;
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
  const openCreate = useQuickRecordStore((state) => state.openCreate);
  const saveMutation = useSaveRecordMutation();
  const deleteMutation = useDeleteRecordMutation();
  const [trendTab, setTrendTab] = useState<DashboardTrendTab>('feeding');
  const [quickBusyKey, setQuickBusyKey] = useState<OneTapKind | null>(null);
  const oneTapLockRef = useRef(false);
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
  const lastMilkML = defaultsQuery.data?.feeding.last_milk_ml ?? FEEDING_BOUNDS.milkDefault;

  const todayLabel = format(now, 'M月d日 EEEE', { locale: zhCN });
  const greeting = getTimeGreeting(now);
  const ageInfo = baby ? formatBabyAge(baby.birth_date, now) : null;

  const trendView = selectTrendView(trends, trendTab);
  const kpiCards = buildDashboardKpiCards(summary, now);

  const oneTapPresets: readonly OneTapPreset[] = [
    {
      kind: 'formula',
      category: 'feeding',
      label: defaultsReady ? `再来一顿 ${lastMilkML} ml` : '加载惯用奶量…',
      icon: Milk,
      buttonClass: 'border-feeding/60 bg-feeding-soft/60 text-feeding-soft-foreground hover:bg-feeding-soft',
      disabled: !defaultsReady,
      toastTitle: `已记录 · ${lastMilkML} ml 配方奶`,
      undoToastTitle: '已撤销刚才的喂养记录',
      buildRequest: (recordedAt) => ({
        category: 'feeding',
        payload: { subtype: 'formula', amount_ml: lastMilkML, recorded_at: recordedAt, note: '' },
      }),
    },
    {
      kind: 'pee',
      category: 'care',
      label: '嘘嘘',
      icon: Droplets,
      buttonClass: 'border-care/60 bg-care-soft/60 text-care-soft-foreground hover:bg-care-soft',
      toastTitle: '已记录 · 嘘嘘',
      undoToastTitle: '已撤销刚才的护理记录',
      buildRequest: (recordedAt) => ({
        category: 'care',
        payload: { subtype: 'diaper', diaper_kind: 'pee', recorded_at: recordedAt, note: '' },
      }),
    },
    {
      kind: 'poop',
      category: 'care',
      label: '便便正常',
      icon: Baby,
      buttonClass: 'border-care/60 bg-care-soft/60 text-care-soft-foreground hover:bg-care-soft',
      toastTitle: '已记录 · 便便正常',
      undoToastTitle: '已撤销刚才的护理记录',
      buildRequest: (recordedAt) => ({
        category: 'care',
        payload: {
          subtype: 'diaper',
          diaper_kind: 'poop',
          stool_consistency: 'soft',
          stool_color: 'yellow',
          recorded_at: recordedAt,
          note: '',
        },
      }),
    },
    {
      kind: 'bath',
      category: 'care',
      label: '洗澡',
      icon: Bath,
      buttonClass: 'border-border bg-secondary/70 text-secondary-foreground hover:bg-secondary',
      toastTitle: '已记录 · 洗澡',
      undoToastTitle: '已撤销刚才的洗澡记录',
      buildRequest: (recordedAt) => ({
        category: 'care',
        payload: { subtype: 'bath', recorded_at: recordedAt, note: '' },
      }),
    },
  ];

  async function undoRecord(category: RecordCategory, id: number, successTitle: string) {
    try {
      await deleteMutation.mutateAsync({ category, id });
      toast.info(successTitle);
    } catch (cause) {
      toast.error('撤销失败', cause instanceof Error ? cause.message : '请前往记录页手动删除。');
    }
  }

  async function handleOneTap(preset: OneTapPreset) {
    if (oneTapLockRef.current || quickBusyKey || preset.disabled) return;
    oneTapLockRef.current = true;
    setQuickBusyKey(preset.kind);
    const recordedAt = new Date().toISOString();
    const timeText = formatLocalTimeFromISO(recordedAt);

    try {
      const created = await saveMutation.mutateAsync(preset.buildRequest(recordedAt));
      let undone = false;
      toast.success(preset.toastTitle, `记录时间 ${timeText}`, {
        action: {
          label: '撤销',
          onClick: () => {
            if (undone) return;
            undone = true;
            void undoRecord(preset.category, created.id, preset.undoToastTitle);
          },
        },
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '快捷记录失败，请重试');
    } finally {
      oneTapLockRef.current = false;
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
        {oneTapPresets.map((preset) => {
          const Icon = preset.icon;
          const busy = quickBusyKey === preset.kind;
          return (
            <button
              key={preset.kind}
              type="button"
              disabled={quickBusyKey !== null || Boolean(preset.disabled)}
              onClick={() => void handleOneTap(preset)}
              className={cn(
                'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                preset.buttonClass,
              )}
            >
              {busy ? (
                <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
              ) : (
                <Icon className="size-3.5" />
              )}
              <span className="tabular-nums">{preset.label}</span>
            </button>
          );
        })}
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
              <CardDescription>{trendView.description}</CardDescription>
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
            ) : !trendView.hasCurrentTrendData ? (
              <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
                <p className="text-sm font-medium text-foreground">
                  {trendTab === 'sleep' ? '近 7 日还没有睡眠记录' : '近 7 日还没有喂养记录'}
                </p>
                <Button size="sm" variant="outline" onClick={() => openCreate(trendTab)}>
                  <PlusIcon className="size-3.5" />
                  {RECORD_CATEGORY_META[trendTab].createLabel}
                </Button>
              </div>
            ) : (
              <ChartContainer config={trendChartConfig} className="aspect-auto h-60 w-full">
                <AreaChart data={trendView.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
                    content={<DashboardTrendTooltip tab={trendTab} isDirectBreastMode={trendView.isDirectBreastMode} />}
                  />
                  <Area
                    type="monotone"
                    dataKey={trendView.dataKey}
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
            ) : !trendView.hasSlotData ? (
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

      {/* 紧凑四分类快捷录入入口 */}
      <div className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4">
        {RECORD_CATEGORIES.map((category) => {
          const meta = RECORD_CATEGORY_META[category];
          const Icon = meta.icon;
          return (
            <button
              key={meta.id}
              type="button"
              onClick={() => openCreate(meta.id)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-2xl border border-border/80 px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                meta.quickCardClass,
              )}
            >
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', meta.softClass)}>
                <Icon className="size-4.5" />
              </span>
              <span className="text-sm font-medium text-foreground">{meta.createLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
