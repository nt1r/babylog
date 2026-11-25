import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, PencilIcon, PlusIcon, RotateCw, Ruler, Sparkles, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { GrowthTrendCard } from '@/components/growth/growth-trend-card';
import { ListPageCard } from '@/components/list-page-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QuickChip } from '@/components/ui/choice-controls';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InfoPopover } from '@/components/ui/info-popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBabyProfileQuery } from '@/lib/baby';
import { GROWTH_SUBTYPE_OPTIONS, HEALTH_SUBTYPE_LABELS } from '@/lib/categories';
import {
  buildGrowthMetricTiles,
  formatGrowthMetricDate,
  formatTeethSummaryText,
  useDashboardSummaryQuery,
} from '@/lib/dashboard';
import {
  flattenInfiniteList,
  type HealthRecord,
  RANGE_LABELS,
  type RecordRange,
  useDeleteRecordMutation,
  useGrowthChartQuery,
  useRecordListQuery,
} from '@/lib/records';
import { useGrowthRecordStore } from '@/stores/growth-record';

export const Route = createFileRoute('/_app/growth')({
  component: GrowthPage,
});

const SUBTYPE_TABS = [{ value: 'all', label: '全部' }, ...GROWTH_SUBTYPE_OPTIONS] as const;
const RANGE_OPTIONS: ReadonlyArray<RecordRange> = ['all', '30d', '7d', 'today'];

function describeGrowthRow(rec: HealthRecord): { badge: string; title: string } {
  if (rec.subtype === 'teeth') {
    return {
      badge: HEALTH_SUBTYPE_LABELS.teeth,
      title: rec.tooth_note ?? '出牙记录',
    };
  }
  const metrics: string[] = [];
  if (rec.weight_kg !== null) metrics.push(`体重 ${rec.weight_kg} kg`);
  if (rec.height_cm !== null) metrics.push(`身高 ${rec.height_cm} cm`);
  if (rec.head_cm !== null) metrics.push(`头围 ${rec.head_cm} cm`);
  return {
    badge: HEALTH_SUBTYPE_LABELS.growth,
    title: metrics.join(' · ') || '生长记录',
  };
}

function GrowthPage() {
  const [filter, setFilter] = useState<'all' | 'growth' | 'teeth'>('all');
  const [range, setRange] = useState<RecordRange>('all');
  const [deleting, setDeleting] = useState<HealthRecord | null>(null);

  const openCreate = useGrowthRecordStore((state) => state.openCreate);
  const openEdit = useGrowthRecordStore((state) => state.openEdit);

  // 低频生长发育页关闭 60 秒轮询，仅在页面进入、记录提交或宝宝档案变更失效时刷新。
  const babyQuery = useBabyProfileQuery();
  const summaryQuery = useDashboardSummaryQuery({ refetchInterval: false });
  const growthChartQuery = useGrowthChartQuery();
  const listQuery = useRecordListQuery('health', {
    subtype: filter === 'all' ? 'growth,teeth' : filter,
    range,
  });
  const deleteMutation = useDeleteRecordMutation();

  const growth = summaryQuery.data?.growth;
  const referenceDateStr = summaryQuery.data?.date;
  const { items, total } = flattenInfiniteList(listQuery.data);
  const growthChartRecords = growthChartQuery.data?.items ?? [];
  const growthChartError = growthChartQuery.isError || babyQuery.isError;
  const growthChartErrorMessage =
    growthChartQuery.error instanceof Error
      ? growthChartQuery.error.message
      : babyQuery.error instanceof Error
        ? babyQuery.error.message
        : undefined;

  function handleOpenCreate() {
    openCreate(filter === 'teeth' ? 'teeth' : 'growth');
  }

  async function handleConfirmDelete() {
    if (!deleting || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync({ category: 'health', id: deleting.id });
      toast.success('生长发育记录已删除');
      setDeleting(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

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
        baby={babyQuery.data}
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

      {/* 历史记录列表（默认全部时间，按日期展示） */}
      <ListPageCard
        title="生长发育"
        badge={
          <span className="flex size-7 items-center justify-center rounded-lg bg-health-soft text-health-soft-foreground">
            <Ruler className="size-4" strokeWidth={1.8} />
          </span>
        }
        headerAction={
          <Button size="sm" onClick={handleOpenCreate}>
            <PlusIcon className="size-4" />
            记一笔生长
          </Button>
        }
        filters={
          <Tabs
            value={filter}
            onValueChange={(value) => {
              const next = String(value);
              setFilter(next === 'growth' || next === 'teeth' ? next : 'all');
            }}
          >
            <TabsList>
              {SUBTYPE_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        actions={
          <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0" aria-label="时间范围筛选">
            {RANGE_OPTIONS.map((option) => (
              <QuickChip key={option} variant="outline" active={range === option} onClick={() => setRange(option)}>
                {RANGE_LABELS[option]}
              </QuickChip>
            ))}
          </fieldset>
        }
      >
        {listQuery.isLoading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : listQuery.isError && items.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <span className="flex size-11 items-center justify-center rounded-2xl bg-destructive-soft text-destructive-soft-foreground">
                <AlertCircle className="size-5" />
              </span>
            </EmptyMedia>
            <EmptyTitle>记录加载失败</EmptyTitle>
            <EmptyDescription>
              {listQuery.error instanceof Error ? listQuery.error.message : '无法加载生长发育记录'}
            </EmptyDescription>
            <EmptyActions>
              <Button variant="outline" onClick={() => void listQuery.refetch()}>
                <RotateCw className="size-4" />
                重新加载
              </Button>
            </EmptyActions>
          </Empty>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <LittleMoments className="max-w-44" />
            </EmptyMedia>
            <EmptyTitle>当前范围内还没有生长发育记录</EmptyTitle>
            <EmptyDescription>记录每次儿保测量的体重、身高、头围和宝宝的出牙里程碑，见证成长变化。</EmptyDescription>
            <EmptyActions>
              <Button onClick={handleOpenCreate}>
                <Ruler className="size-4" />
                记一笔生长
              </Button>
              {range !== 'all' ? (
                <Button variant="outline" onClick={() => setRange('all')}>
                  查看全部时间
                </Button>
              ) : null}
            </EmptyActions>
          </Empty>
        ) : (
          /* 低频生长与出牙记录不复用 RecordListPage：按纯日期平铺倒序展示，省略按日小计分组与“再记一笔”快捷复制。 */
          <div className="space-y-2">
            {items.map((rec) => {
              const row = describeGrowthRow(rec);
              const dateLabel = formatGrowthMetricDate(rec.recorded_at, referenceDateStr) || '--';
              return (
                <div
                  key={rec.id}
                  className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-background/60 px-3.5 py-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <button
                    type="button"
                    onClick={() => openEdit(rec)}
                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="mt-0.5 min-w-16 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
                      {dateLabel}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="health">{row.badge}</Badge>
                        <span className="text-sm font-medium text-foreground tabular-nums">{row.title}</span>
                      </div>
                      {rec.note ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground/90">备注：{rec.note}</p>
                      ) : null}
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="编辑记录"
                            onClick={() => openEdit(rec)}
                            className="size-9 text-muted-foreground hover:text-foreground sm:size-8"
                          />
                        }
                      >
                        <PencilIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>编辑记录</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="删除记录"
                            onClick={() => setDeleting(rec)}
                            className="ml-2 size-9 text-muted-foreground hover:bg-destructive-soft/70 hover:text-destructive sm:ml-1.5 sm:size-8"
                          />
                        }
                      >
                        <Trash2Icon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>删除记录</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}

            {listQuery.isFetchNextPageError ? (
              <div className="flex flex-col items-center gap-2 pt-2 text-center">
                <p className="text-xs text-destructive">
                  {listQuery.error instanceof Error ? listQuery.error.message : '加载更多失败，请重试'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {listQuery.isFetchingNextPage ? (
                    <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
                  ) : (
                    <RotateCw className="size-3.5" />
                  )}
                  {listQuery.isFetchingNextPage ? '加载中…' : '重试加载更多'}
                </Button>
              </div>
            ) : listQuery.hasNextPage ? (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {listQuery.isFetchingNextPage ? '加载中…' : `加载更多（已显示 ${items.length} / ${total}）`}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </ListPageCard>

      <DeleteConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="确认删除这条生长发育记录？"
        description={
          deleting
            ? `将删除 ${formatGrowthMetricDate(deleting.recorded_at, referenceDateStr) || '--'} 的「${describeGrowthRow(deleting).badge} · ${describeGrowthRow(deleting).title}」，删除后不可恢复。`
            : ''
        }
        confirmLabel={deleteMutation.isPending ? '正在删除…' : '确认删除'}
        pending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
