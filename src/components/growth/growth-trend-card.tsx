import { AlertCircle, Download, PlusIcon, RotateCw, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { InfoPopover } from '@/components/ui/info-popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useChartImageExport } from '@/hooks/use-chart-image-export';
import type { BabyProfile } from '@/lib/baby';
import { buildGrowthChartSeries, type GrowthChartMetric, type GrowthChartPoint } from '@/lib/growth-chart';
import type { HealthRecord } from '@/lib/records';
import { formatBabyAge } from '@/lib/time';

interface GrowthTrendCardProps {
  readonly baby: BabyProfile | null | undefined;
  readonly records: readonly HealthRecord[];
  readonly isLoading: boolean;
  readonly isError?: boolean;
  readonly errorMessage?: string;
  readonly hasMoreHistory?: boolean;
  readonly onRetry?: () => void;
  readonly onOpenCreate: () => void;
}

const CHART_CONFIG: ChartConfig = {
  value: { label: '宝宝实测', color: 'var(--health)' },
  whoP50: { label: 'WHO 中位线（P50）', color: 'var(--primary)' },
  whoRange: { label: 'WHO 参考区间（P3–P97）', color: 'var(--primary)' },
};

function GrowthCurveTooltip({
  active,
  payload,
  unit,
  metricLabel,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ payload?: GrowthChartPoint }>;
  readonly unit: string;
  readonly metricLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="grid min-w-44 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="flex items-center justify-between gap-3 font-medium text-foreground">
        <span>{point.ageMonths <= 0 ? '出生时' : `${Number(point.ageMonths.toFixed(1))} 月龄`}</span>
        {point.dateKey ? <span className="font-normal text-muted-foreground tabular-nums">{point.dateKey}</span> : null}
      </div>

      {point.value !== null ? (
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-foreground">
            <span className="size-2 shrink-0 rounded-full bg-health" />
            {point.isBirth ? `出生${metricLabel}` : `实测${metricLabel}`}
          </span>
          <span className="font-semibold text-foreground tabular-nums">
            {point.value} {unit}
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span>WHO 中位（P50）</span>
        <span className="tabular-nums">
          {point.whoP50} {unit}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <span>参考区间（P3–P97）</span>
        <span className="tabular-nums">
          {point.whoP3}–{point.whoP97} {unit}
        </span>
      </div>
    </div>
  );
}

/** 生长发育曲线卡片：支持体重/身高/头围切换，并按宝宝性别叠加 WHO P3–P97 参考带与 P50 中位线。 */
export function GrowthTrendCard({
  baby,
  records,
  isLoading,
  isError = false,
  errorMessage,
  hasMoreHistory = false,
  onRetry,
  onOpenCreate,
}: GrowthTrendCardProps) {
  const [metric, setMetric] = useState<GrowthChartMetric>('weight');
  const { containerRef: chartBoxRef, exporting, saveImage } = useChartImageExport();

  const series = useMemo(() => buildGrowthChartSeries(metric, records, baby), [metric, records, baby]);
  const canExport = !isLoading && !isError && series.measurementCount > 0;

  function handleSaveImage() {
    if (!canExport) return;
    const ageLabel = baby?.birth_date ? formatBabyAge(baby.birth_date).ageLabel : '';
    const subtitleParts = [
      baby?.nickname ? (ageLabel ? `${baby.nickname}（${ageLabel}）` : baby.nickname) : '',
      `WHO 2006 ${series.genderLabel} P3–P97 参考区间`,
    ].filter(Boolean);
    void saveImage({
      title: `生长发育曲线 · ${series.label}`,
      subtitle: subtitleParts.join(' · '),
      filenameBase: `${baby?.nickname ? `${baby.nickname}-` : ''}生长曲线-${series.label}`,
      legend: [
        { label: `宝宝${series.label} (${series.unit})`, colorVar: '--health' },
        { label: 'WHO 中位线 P50 / 参考区间 P3–P97', colorVar: '--primary' },
      ],
      successMessage: '生长发育曲线已保存为图片',
    });
  }

  const statusBadge =
    !isError && !isLoading ? (
      series.latestBandStatus === 'in_range' ? (
        <Badge variant="success">位于 P3–P97 参考区间内</Badge>
      ) : series.latestBandStatus === 'above' ? (
        <Badge variant="info">高于 P97 参考线</Badge>
      ) : series.latestBandStatus === 'below' ? (
        <Badge variant="warning">低于 P3 参考线</Badge>
      ) : null
    ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <TrendingUp className="size-4 text-health" strokeWidth={1.8} />
            <span>生长发育曲线</span>
            <InfoPopover title="WHO 生长参考曲线说明" ariaLabel="查看生长参考曲线说明">
              <div className="space-y-2">
                <p>
                  浅绿阴影带表示世界卫生组织（WHO 2006）0–5 岁儿童{series.genderLabel}
                  <span className="font-medium text-foreground"> P3–P97 参考区间</span>，虚线为中位线（P50）。
                </p>
                <p>
                  每个宝宝遗传与发育节奏不同，单次数值高低不必焦虑，观察宝宝是否沿自身百分位平稳增长更有参考价值；如有疑虑请咨询儿保医生。
                </p>
              </div>
            </InfoPopover>
          </CardTitle>
          {statusBadge}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={metric}
            onValueChange={(value) => {
              const next = String(value);
              setMetric(next === 'height' || next === 'head' ? next : 'weight');
            }}
          >
            <TabsList>
              <TabsTrigger value="weight">体重</TabsTrigger>
              <TabsTrigger value="height">身高</TabsTrigger>
              <TabsTrigger value="head">头围</TabsTrigger>
            </TabsList>
          </Tabs>
          {canExport ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void handleSaveImage()}
              className="h-8 gap-1.5 px-2.5 text-xs"
              aria-label={`将${series.label}生长发育曲线保存为图片`}
            >
              {exporting ? (
                <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
              ) : (
                <Download className="size-3.5" strokeWidth={1.8} />
              )}
              <span>保存图片</span>
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5">
        {isLoading ? (
          <Skeleton className="h-60 w-full rounded-xl" />
        ) : isError ? (
          <div className="flex h-52 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive-soft/20 p-6 text-center">
            <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive-soft-foreground">{errorMessage ?? '生长曲线数据加载失败'}</p>
            {onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RotateCw className="size-3.5" />
                重新加载
              </Button>
            ) : null}
          </div>
        ) : series.measurementCount === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {series.beyondWhoCount > 0
                ? `已有 ${series.beyondWhoCount} 条 5 岁以上${series.label}记录`
                : `还没有${series.label}测量记录`}
            </p>
            <p className="text-xs text-muted-foreground">
              {series.beyondWhoCount > 0
                ? 'WHO 婴幼儿标准曲线覆盖 0–5 岁，5 岁以上记录可在下方历史列表中查看。'
                : `记下每次儿保测量的${series.label}，即可对照 WHO 参考曲线观察成长趋势。`}
            </p>
            {series.beyondWhoCount === 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={onOpenCreate}>
                <PlusIcon className="size-3.5" />
                记一笔{series.label}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <span className="size-2.5 rounded-full bg-health" />
                  宝宝{series.label}（{series.unit}）
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3.5 border-t border-dashed border-primary/80" />
                  WHO 中位线 P50
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-xs bg-primary/15 ring-1 ring-primary/25" />
                  WHO {series.genderLabel} P3–P97
                </span>
              </div>
              {series.measurementCount === 1 ? (
                <span>再记一次即可连成成长曲线</span>
              ) : (
                <span className="tabular-nums">共 {series.measurementCount} 个测量点</span>
              )}
            </div>

            {series.deltaFromPrev || series.deltaFromBirth ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {series.deltaFromPrev ? (
                  <Badge variant="outline" className="font-normal tabular-nums">
                    较上次 {series.deltaFromPrev.formatted}
                    {series.deltaFromPrev.spanLabel ? `（${series.deltaFromPrev.spanLabel}）` : ''}
                  </Badge>
                ) : null}
                {series.deltaFromBirth ? (
                  <Badge variant="outline" className="font-normal tabular-nums">
                    较出生 {series.deltaFromBirth.formatted}
                    {series.deltaFromBirth.spanLabel ? `（${series.deltaFromBirth.spanLabel}）` : ''}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            <div ref={chartBoxRef} className="w-full">
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-64 w-full">
                <ComposedChart data={[...series.points]} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="ageMonths"
                    type="number"
                    domain={[0, series.maxMonth]}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(v: number) => (v === 0 ? '出生' : `${v}月`)}
                  />
                  <YAxis domain={series.yDomain} tickLine={false} axisLine={false} tickMargin={8} width={42} />
                  <ChartTooltip content={<GrowthCurveTooltip unit={series.unit} metricLabel={series.label} />} />
                  {/* 关闭 Recharts 入场动画，确保切换体重/身高/头围指标时曲线与参考带即时重绘不抖动 */}
                  <Area
                    type="monotone"
                    dataKey="whoRange"
                    stroke="none"
                    fill="var(--primary)"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="whoP50"
                    stroke="var(--primary)"
                    strokeOpacity={0.55}
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--health)"
                    strokeWidth={2.4}
                    connectNulls
                    isAnimationActive={false}
                    dot={{ r: 4, fill: 'var(--health)', stroke: 'var(--card)', strokeWidth: 2 }}
                    activeDot={{ r: 5.5, fill: 'var(--health)', stroke: 'var(--card)', strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ChartContainer>
            </div>

            {series.beyondWhoCount > 0 || hasMoreHistory ? (
              <p className="text-xs text-muted-foreground">
                {[
                  series.beyondWhoCount > 0
                    ? `另有 ${series.beyondWhoCount} 条 5 岁以上记录超出 WHO 0–5 岁曲线范围，可在下方列表查看`
                    : '',
                  hasMoreHistory ? '曲线当前展示最近 100 条测量记录' : '',
                ]
                  .filter(Boolean)
                  .join('；')}
                。
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
