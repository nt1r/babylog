import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ArrowUpRight, Baby, HeartPulse, Milk, MoonStar, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { LittleMoments } from '@/components/brand/little-moments';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
});

const PREVIEW_TREND_DATA = [
  { day: '周一', feeding: 740, sleep: 13.8 },
  { day: '周二', feeding: 780, sleep: 14.2 },
  { day: '周三', feeding: 720, sleep: 13.5 },
  { day: '周四', feeding: 810, sleep: 14.6 },
  { day: '周五', feeding: 790, sleep: 14.1 },
  { day: '周六', feeding: 830, sleep: 14.8 },
  { day: '周日', feeding: 760, sleep: 14.3 },
];

const PREVIEW_SLOT_DATA = [
  { slot: '清晨', count: 2 },
  { slot: '上午', count: 3 },
  { slot: '下午', count: 3 },
  { slot: '傍晚', count: 2 },
  { slot: '夜间', count: 2 },
];

const trendChartConfig: ChartConfig = {
  feeding: {
    label: '每日奶量',
    color: 'var(--feeding)',
  },
  sleep: {
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

const KPI_CARDS = [
  {
    id: 'feeding',
    label: '今日喂养',
    value: '0 ml',
    sub: '母乳、奶粉与辅食',
    iconClass: 'bg-feeding-soft text-feeding-soft-foreground',
    icon: Milk,
    to: '/feeding' as const,
  },
  {
    id: 'sleep',
    label: '今日睡眠',
    value: '0 h',
    sub: '小睡与夜觉时长',
    iconClass: 'bg-sleep-soft text-sleep-soft-foreground',
    icon: MoonStar,
    to: '/sleep' as const,
  },
  {
    id: 'health',
    label: '最近体温',
    value: '— ℃',
    sub: '体温、用药与生长',
    iconClass: 'bg-health-soft text-health-soft-foreground',
    icon: HeartPulse,
    to: '/health' as const,
  },
  {
    id: 'care',
    label: '今日护理',
    value: '0 次',
    sub: '排便、尿布与洗澡',
    iconClass: 'bg-care-soft text-care-soft-foreground',
    icon: Baby,
    to: '/care' as const,
  },
] as const;

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
  const user = useAuthStore((state) => state.user);
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const [trendMetric, setTrendMetric] = useState<'feeding' | 'sleep'>('feeding');

  const now = new Date();
  const todayLabel = format(now, 'M月d日 EEEE', { locale: zhCN });
  const greeting = getTimeGreeting(now);

  const isFeedingTrend = trendMetric === 'feeding';

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting}，{user?.username ?? '奶爸'}
          </h1>
          <Badge variant="secondary" className="font-normal">
            {todayLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">宝宝今天的喂养、睡眠、健康与提醒都在这里。</p>
      </div>

      {/* 4 列核心指标概览 */}
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-4">
        {KPI_CARDS.map((card) => {
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
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">{card.value}</p>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{card.sub}</span>
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
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>近 7 日成长趋势</CardTitle>
                <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                  示例数据
                </Badge>
              </div>
              <CardDescription>{isFeedingTrend ? '每日奶量变化（ml）' : '每日睡眠时长变化（小时）'}</CardDescription>
            </div>
            <Tabs
              value={trendMetric}
              onValueChange={(value) => setTrendMetric(value === 'sleep' ? 'sleep' : 'feeding')}
            >
              <TabsList>
                <TabsTrigger value="feeding">奶量</TabsTrigger>
                <TabsTrigger value="sleep">睡眠</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <ChartContainer config={trendChartConfig} className="aspect-auto h-60 w-full">
              <AreaChart data={PREVIEW_TREND_DATA} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>每日照护节律</CardTitle>
              <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                示例数据
              </Badge>
            </div>
            <CardDescription>全天各时段的照护频次分布</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={slotChartConfig} className="aspect-auto h-60 w-full">
              <BarChart data={PREVIEW_SLOT_DATA} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="slot" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent unit="次" />} />
                <Bar dataKey="count" fill="var(--sleep)" radius={[8, 8, 2, 2]} maxBarSize={32} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* 底部快捷录入入口与品牌绘本卡片 */}
      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-3">
        <Card className="@4xl/main:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              快速记录
            </CardTitle>
            <CardDescription>点一下即可记录，少一步操作。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
