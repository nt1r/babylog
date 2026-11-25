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
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import {
  DashboardGrowthCard,
  DashboardVaccineBanner,
  DashboardVaccineCard,
  PostVaccineTempCueBar,
} from '@/components/dashboard/growth-immunity-section';
import { FEEDING_BOUNDS } from '@/components/quick-record/codecs/feeding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useBabyProfileQuery } from '@/lib/baby';
import { RECORD_CATEGORY_META, type RecordCategory } from '@/lib/categories';
import {
  buildAdaptiveFeedingOneTap,
  buildDashboardKpiCards,
  type DashboardTrends,
  type DashboardTrendTab,
  findRecentCompletedVaccineForTempCue,
  selectDashboardVaccineAlert,
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
import { formatDurationMin, formatLocalTimeFromISO } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useVaccinesOverviewQuery, VACCINE_OVERVIEW_STALE_MS } from '@/lib/vaccines';
import { useGrowthRecordStore } from '@/stores/growth-record';
import { useQuickRecordStore } from '@/stores/quick-record';

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
});

type DailyTrendPoint = DashboardTrends['daily'][number];
type OneTapKind = 'formula' | 'pee' | 'poop' | 'bath';

interface OneTapPreset {
  readonly kind: OneTapKind;
  readonly category: RecordCategory;
  readonly title: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly tileClass: string;
  readonly iconClass: string;
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
  const openGrowthCreate = useGrowthRecordStore((state) => state.openCreate);
  const saveMutation = useSaveRecordMutation();
  const deleteMutation = useDeleteRecordMutation();
  const [trendTab, setTrendTab] = useState<DashboardTrendTab>('feeding');
  const [quickBusyKey, setQuickBusyKey] = useState<OneTapKind | null>(null);
  // 同步防重入锁：在 React 状态更新触发按钮禁用前的同一帧内拦截高频连点，防止发出重复写入请求。
  const oneTapLockRef = useRef(false);
  // 每分钟刷新一次本地时钟，确保「距上次喂奶/换尿布 X 分钟前」与昼夜插画在数据无变更时也能实时更新。
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const babyQuery = useBabyProfileQuery();
  const summaryQuery = useDashboardSummaryQuery();
  const trendsQuery = useDashboardTrendsQuery(7);
  const defaultsQuery = useSmartDefaultsQuery();
  // 与 60 秒轮询解耦：设置 5 分钟缓存，首次访问自动触发国家免疫规划懒初始化，疫苗变更后由 mutation 精确失效。
  const vaccinesQuery = useVaccinesOverviewQuery(true, VACCINE_OVERVIEW_STALE_MS);

  const baby = babyQuery.data;
  const summary = summaryQuery.data;
  const trends = trendsQuery.data;
  const vaccines = vaccinesQuery.data;
  const defaultsReady = !defaultsQuery.isLoading;
  const adaptiveFeedingOneTap = buildAdaptiveFeedingOneTap(
    defaultsQuery.data,
    defaultsReady,
    FEEDING_BOUNDS.milkDefault,
    FEEDING_BOUNDS.breastDefault,
  );

  const todayLabel = format(now, 'M月d日 · EEEE', { locale: zhCN });
  const trendView = selectTrendView(trends, trendTab);
  const kpiCards = buildDashboardKpiCards(summary, now);
  const vaccineAlert = selectDashboardVaccineAlert(vaccines);
  const postVaccineCue = findRecentCompletedVaccineForTempCue(vaccines);

  const oneTapPresets: readonly OneTapPreset[] = [
    {
      kind: 'formula',
      category: 'feeding',
      title: adaptiveFeedingOneTap.title,
      hint: adaptiveFeedingOneTap.hint,
      icon: Milk,
      tileClass: 'border-feeding/35 bg-card hover:border-feeding/70 hover:bg-feeding-soft/25',
      iconClass: 'bg-feeding-soft text-feeding-soft-foreground',
      disabled: !defaultsReady,
      toastTitle: adaptiveFeedingOneTap.toastTitle,
      undoToastTitle: '已撤销刚才的喂养记录',
      buildRequest: adaptiveFeedingOneTap.buildRequest,
    },
    {
      kind: 'pee',
      category: 'care',
      title: '嘘嘘',
      hint: '尿布记录',
      icon: Droplets,
      tileClass: 'border-care/35 bg-card hover:border-care/70 hover:bg-care-soft/25',
      iconClass: 'bg-care-soft text-care-soft-foreground',
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
      title: '便便正常',
      hint: '软便 · 黄色',
      icon: Baby,
      tileClass: 'border-care/35 bg-card hover:border-care/70 hover:bg-care-soft/25',
      iconClass: 'bg-care-soft text-care-soft-foreground',
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
      title: '洗澡',
      hint: '日常护理',
      icon: Bath,
      tileClass: 'border-border/80 bg-card hover:border-primary/45 hover:bg-accent/35',
      iconClass: 'bg-secondary text-secondary-foreground',
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
      // 单次撤销守卫：防止用户在 Toast 消失前连续点击“撤销”，对已删除记录重复发 DELETE 误报 404。
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
      {/* 绘本风时光问候与宝宝名片 Hero */}
      <DashboardHero now={now} todayLabel={todayLabel} baby={baby} />

      {/* 条件浮现：需关注疫苗常驻提醒条 */}
      {vaccineAlert ? <DashboardVaccineBanner alert={vaccineAlert} /> : null}

      {/* 高频一键直记：移动端 2×2 触控宫格 / 桌面端 4 列等宽卡片 */}
      <section aria-label="一键直记" className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Zap className="size-3.5 text-primary" />
            一键直记
          </span>
          <span className="text-xs text-muted-foreground">轻点即记 · 支持撤销</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 @3xl/main:grid-cols-4 @3xl/main:gap-3">
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
                  'group flex min-h-14 cursor-pointer items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left shadow-2xs transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:gap-3 sm:px-3.5',
                  preset.tileClass,
                )}
              >
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105',
                    preset.iconClass,
                  )}
                >
                  {busy ? (
                    <Spinner className="size-4" aria-hidden="true" role="presentation" />
                  ) : (
                    <Icon className="size-4.5" strokeWidth={1.8} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-foreground sm:text-sm">
                    {preset.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground tabular-nums">{preset.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 今日照护概览：移动端 2×2 紧凑宫格 / 桌面端 4 列（喂养 / 睡眠 / 护理 / 健康观察） */}
      <section aria-label="今日照护概览" className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-xs font-semibold text-muted-foreground">今日概览</span>
          <span className="text-xs text-muted-foreground">点击查看明细</span>
        </div>

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
          <div className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4 @4xl/main:gap-4">
            {kpiCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link key={card.id} to={card.to} className="group block outline-none">
                  <Card className="h-full gap-2.5 [--card-spacing:--spacing(3.5)] transition-all group-hover:border-primary/40 group-hover:shadow-xs group-focus-visible:ring-2 group-focus-visible:ring-ring sm:gap-3 sm:[--card-spacing:--spacing(5)]">
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                      <CardDescription className="truncate text-[13px] font-medium text-muted-foreground sm:text-sm">
                        {card.label}
                      </CardDescription>
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-9',
                          card.iconClass,
                        )}
                      >
                        <Icon className="size-4 sm:size-4.5" strokeWidth={1.8} />
                      </span>
                    </CardHeader>
                    <CardContent className="space-y-1 sm:space-y-1.5">
                      {summaryQuery.isLoading ? (
                        <Skeleton className="h-7 w-20 rounded-lg sm:h-8 sm:w-24" />
                      ) : (
                        <p
                          className={cn(
                            'truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl',
                            card.alertTone === 'destructive' && 'text-destructive',
                            card.alertTone === 'warning' && 'text-warning',
                          )}
                        >
                          {card.value}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
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
      </section>

      {/* 接种后 48 小时轻量测温联动条：独立于 summaryQuery 错误状态，确保疫苗状态不受今日汇总失败牵连 */}
      {postVaccineCue ? (
        <PostVaccineTempCueBar cue={postVaccineCue} onLogTemperature={() => openCreate('health', 'temperature')} />
      ) : null}

      {/* 2:1 喂养/睡眠趋势与时段分布图 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-3">
        <Card className="@4xl/main:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle>近 7 日照护趋势</CardTitle>
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

      {/* 2 列「成长与免疫」双卡：疫苗接种计划 + 最新生长发育 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-2">
        <DashboardVaccineCard
          overview={vaccines}
          isLoading={vaccinesQuery.isLoading}
          isError={vaccinesQuery.isError}
          onRetry={() => void vaccinesQuery.refetch()}
        />
        <DashboardGrowthCard
          growth={summary?.growth}
          referenceDateStr={summary?.date}
          isLoading={summaryQuery.isLoading}
          isError={summaryQuery.isError}
          onRetry={() => void summaryQuery.refetch()}
          onOpenCreate={openGrowthCreate}
        />
      </div>
    </div>
  );
}
