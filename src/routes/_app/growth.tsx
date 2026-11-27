import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, RotateCw, Ruler, Sparkles } from 'lucide-react';
import { GrowthTrendCard } from '@/components/growth/growth-trend-card';
import { RecordListPage, type RecordRowDescriptor } from '@/components/record-list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoPopover } from '@/components/ui/info-popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveBaby } from '@/lib/baby';
import { GROWTH_SUBTYPE_OPTIONS, HEALTH_SUBTYPE_LABELS } from '@/lib/categories';
import {
  buildGrowthMetricTiles,
  formatGrowthMetricDate,
  formatTeethSummaryText,
  useGrowthSummaryQuery,
} from '@/lib/growth';
import { type HealthRecord, type RecordRange, useGrowthChartQuery } from '@/lib/records';
import { useOverlayStore } from '@/stores/overlays';

export const Route = createFileRoute('/_app/growth')({
  component: GrowthPage,
});

const SUBTYPE_TABS = [{ value: 'all', label: '全部' }, ...GROWTH_SUBTYPE_OPTIONS] as const;
const RANGE_OPTIONS: ReadonlyArray<RecordRange> = ['all', '30d', '7d', 'today'];

function describeGrowthRow(rec: HealthRecord, referenceDateStr?: string): RecordRowDescriptor {
  const timeLabel = formatGrowthMetricDate(rec.recorded_at, referenceDateStr) || '--';
  if (rec.subtype === 'teeth') {
    return {
      timeLabel,
      badge: HEALTH_SUBTYPE_LABELS.teeth,
      title: rec.tooth_note ?? '出牙记录',
    };
  }
  const metrics: string[] = [];
  if (rec.weight_kg !== null) metrics.push(`体重 ${rec.weight_kg} kg`);
  if (rec.height_cm !== null) metrics.push(`身高 ${rec.height_cm} cm`);
  if (rec.head_cm !== null) metrics.push(`头围 ${rec.head_cm} cm`);
  return {
    timeLabel,
    badge: HEALTH_SUBTYPE_LABELS.growth,
    title: metrics.join(' · ') || '生长记录',
  };
}

function GrowthPage() {
  const openCreate = useOverlayStore((state) => state.openGrowthCreate);
  const openEdit = useOverlayStore((state) => state.openGrowthEdit);

  const { activeBaby, babiesQuery: babyQuery } = useActiveBaby();
  const summaryQuery = useGrowthSummaryQuery();
  const growthChartQuery = useGrowthChartQuery();

  const growth = summaryQuery.data?.growth;
  const referenceDateStr = summaryQuery.data?.referenceDate;
  const growthChartRecords = growthChartQuery.data?.items ?? [];
  const growthChartError = growthChartQuery.isError || babyQuery.isError;
  const growthChartErrorMessage =
    growthChartQuery.error instanceof Error
      ? growthChartQuery.error.message
      : babyQuery.error instanceof Error
        ? babyQuery.error.message
        : undefined;

  const physicalTiles = buildGrowthMetricTiles(growth, referenceDateStr);
  const overviewMetrics = [
    ...physicalTiles.map((tile) => ({
      key: tile.key,
      label: tile.fullLabel,
      value: tile.value,
      isBirth: tile.isBirth,
      sub: tile.detailDate,
    })),
    {
      key: 'teeth',
      label: '乳牙萌出',
      value: growth && growth.teeth_count > 0 ? `已出 ${growth.teeth_count} 颗` : '0 颗',
      isBirth: false,
      sub: formatTeethSummaryText(growth, referenceDateStr, '记录宝宝的第一颗乳牙'),
    },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部生长概览卡 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Sparkles className="size-4 text-health" strokeWidth={1.8} />
            <span>生长发育概览</span>
            <InfoPopover title="体格指标统计说明" ariaLabel="查看生长发育指标统计说明">
              <p>
                体重、身高与头围各自独立取最新一次有效测量值；若某项尚未手动录入，则自动沿用宝宝档案中的出生体格数据作为基准。
              </p>
            </InfoPopover>
          </CardTitle>
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => openCreate('teeth')}>
            记一笔出牙
          </Button>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-3 @3xl/main:grid-cols-4">
              <Skeleton className="h-22 rounded-xl" />
              <Skeleton className="h-22 rounded-xl" />
              <Skeleton className="h-22 rounded-xl" />
              <Skeleton className="h-22 rounded-xl" />
            </div>
          ) : summaryQuery.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive-soft/25 px-3.5 py-3">
              <div className="flex items-center gap-2 text-xs text-destructive-soft-foreground">
                <AlertCircle className="size-4 shrink-0" />
                <span>{summaryQuery.error instanceof Error ? summaryQuery.error.message : '生长概览加载失败'}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
                <RotateCw className="size-3.5" />
                重新加载
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 @3xl/main:grid-cols-4">
              {overviewMetrics.map((metric) => (
                <div
                  key={metric.key}
                  className="flex flex-col justify-between gap-1.5 rounded-xl border border-border/75 bg-muted/25 px-3.5 py-3"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
                    {metric.isBirth ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal">
                        出生
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xl font-semibold tracking-tight text-foreground tabular-nums">{metric.value}</p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">{metric.sub}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 生长发育曲线（体重 / 身高 / 头围 + WHO 参考区间） */}
      <GrowthTrendCard
        baby={activeBaby}
        records={growthChartRecords}
        isLoading={growthChartQuery.isLoading || babyQuery.isLoading}
        isError={growthChartError}
        errorMessage={growthChartErrorMessage}
        hasMoreHistory={Boolean(growthChartQuery.data?.has_more)}
        onRetry={() => {
          void growthChartQuery.refetch();
          if (babyQuery.isError) void babyQuery.refetch();
        }}
        onOpenCreate={() => openCreate('growth')}
      />

      {/* 历史记录列表（复用 RecordListPage 平铺模式，默认全部时间并隐藏“再记一笔”） */}
      <RecordListPage
        category="health"
        layout="flat"
        title="生长发育"
        icon={Ruler}
        badgeClassName="bg-health-soft text-health-soft-foreground"
        createButtonLabel="记一笔生长"
        defaultRange="all"
        rangeOptions={RANGE_OPTIONS}
        allSubtypeFilter="growth,teeth"
        subtypeTabs={SUBTYPE_TABS}
        loadErrorFallback="无法加载生长发育记录"
        emptyTitle="当前范围内还没有生长发育记录"
        emptyDescription="记录每次儿保测量的体重、身高、头围和宝宝的出牙里程碑，见证成长变化。"
        deleteDialogTitle="确认删除这条生长发育记录？"
        deleteSuccessToast="生长发育记录已删除"
        onCreate={(activeFilter) => openCreate(activeFilter === 'teeth' ? 'teeth' : 'growth')}
        onEdit={openEdit}
        describeRow={(rec) => describeGrowthRow(rec, referenceDateStr)}
        formatDeleteDescription={(rec) => {
          const row = describeGrowthRow(rec, referenceDateStr);
          return `将删除 ${row.timeLabel} 的「${row.badge} · ${row.title}」，删除后不可恢复。`;
        }}
      />
    </div>
  );
}
