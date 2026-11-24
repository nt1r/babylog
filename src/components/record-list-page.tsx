import { AlertCircle, CopyPlus, type LucideIcon, PencilIcon, PlusIcon, RotateCw, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { ListPageCard } from '@/components/list-page-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuickChip } from '@/components/ui/choice-controls';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import type { RecordCategory } from '@/lib/categories';
import {
  type DailySummaryOf,
  flattenInfiniteList,
  RANGE_LABELS,
  type RecordOf,
  type RecordRange,
  toEditableRecord,
  useDeleteRecordMutation,
  useRecordListQuery,
} from '@/lib/records';
import { formatDateGroupLabel } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useQuickRecordStore } from '@/stores/quick-record';

const RANGE_OPTIONS: ReadonlyArray<RecordRange> = ['today', '7d', '30d', 'all'];

interface GroupedDay<T> {
  readonly dateKey: string;
  readonly items: readonly T[];
}

function groupItemsByDateKey<T>(items: readonly T[], getDateKey: (item: T) => string): GroupedDay<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getDateKey(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries()).map(([dateKey, grouped]) => ({ dateKey, items: grouped }));
}

function RangeFilterPills({
  value,
  onChange,
}: {
  readonly value: RecordRange;
  readonly onChange: (next: RecordRange) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0" aria-label="时间范围筛选">
      {RANGE_OPTIONS.map((range) => (
        <QuickChip key={range} variant="outline" active={value === range} onClick={() => onChange(range)}>
          {RANGE_LABELS[range]}
        </QuickChip>
      ))}
    </fieldset>
  );
}

function RecordListSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-40 rounded-lg" />
      <div className="space-y-2.5">
        <Skeleton className="h-18 w-full rounded-xl" />
        <Skeleton className="h-18 w-full rounded-xl" />
        <Skeleton className="h-18 w-full rounded-xl" />
      </div>
    </div>
  );
}

function RecordListError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <Empty>
      <EmptyMedia>
        <span className="flex size-11 items-center justify-center rounded-2xl bg-destructive-soft text-destructive-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
      </EmptyMedia>
      <EmptyTitle>记录加载失败</EmptyTitle>
      <EmptyDescription>{message}</EmptyDescription>
      <EmptyActions>
        <Button variant="outline" onClick={onRetry}>
          <RotateCw className="size-4" />
          重新加载
        </Button>
      </EmptyActions>
    </Empty>
  );
}

function RecordDayGroup({
  dateKey,
  summary,
  children,
}: {
  readonly dateKey: string;
  readonly summary?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-foreground">{formatDateGroupLabel(dateKey)}</h2>
        {summary ? <p className="text-xs text-muted-foreground tabular-nums">{summary}</p> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function RecordRowCard({
  timeLabel,
  badge,
  title,
  subtitle,
  note,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  readonly timeLabel: string;
  readonly badge: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly note?: string;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-background/60 px-3.5 py-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="mt-0.5 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">{timeLabel}</span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            <span className="text-sm font-medium text-foreground tabular-nums">{title}</span>
          </div>
          {subtitle ? <p className="text-xs text-muted-foreground tabular-nums">{subtitle}</p> : null}
          {note ? <p className="text-xs text-muted-foreground/90">备注：{note}</p> : null}
        </div>
      </button>

      {/* 放大触控面积并在编辑与删除之间拉大安全间距，降低移动端单手误触删除风险 */}
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDuplicate}
          title="以当前时间再记一笔相同内容"
          className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:h-8"
        >
          <CopyPlus className="size-3.5" />
          再记一笔
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="编辑记录"
          onClick={onEdit}
          className="size-9 text-muted-foreground hover:text-foreground sm:size-8"
        >
          <PencilIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="删除记录"
          onClick={onDelete}
          className="ml-2 size-9 text-muted-foreground hover:bg-destructive-soft/70 hover:text-destructive sm:ml-1.5 sm:size-8"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

interface SubtypeTabOption {
  readonly value: string;
  readonly label: string;
}

export interface RecordRowDescriptor {
  readonly timeLabel: string;
  readonly badge: string;
  readonly badgeVariant?: RecordCategory | 'warning' | 'destructive';
  readonly title: string;
  readonly subtitle?: string;
}

interface RecordListPageProps<C extends RecordCategory> {
  readonly category: C;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly badgeClassName: string;
  readonly createButtonLabel: string;
  readonly defaultRange?: RecordRange;
  readonly allSubtypeFilter?: string;
  readonly subtypeTabs: readonly SubtypeTabOption[];
  readonly loadErrorFallback: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly deleteDialogTitle: string;
  readonly deleteSuccessToast: string;
  readonly getDateKey: (rec: RecordOf<C>) => string;
  readonly formatDailySummary: (sum?: DailySummaryOf<C>) => string;
  readonly describeRow: (rec: RecordOf<C>) => RecordRowDescriptor;
  readonly formatDeleteDescription: (rec: RecordOf<C>) => string;
}

/**
 * 统一日常记录列表页深模块：吸收子类型筛选、时间范围、无限分页、按日分组、
 * 快捷录入入口与删除确认弹窗编排，各业务路由仅声明品类配置与纯格式化函数。
 */
export function RecordListPage<C extends RecordCategory>({
  category,
  title,
  icon: Icon,
  badgeClassName,
  createButtonLabel,
  defaultRange = '7d',
  allSubtypeFilter,
  subtypeTabs,
  loadErrorFallback,
  emptyTitle,
  emptyDescription,
  deleteDialogTitle,
  deleteSuccessToast,
  getDateKey,
  formatDailySummary,
  describeRow,
  formatDeleteDescription,
}: RecordListPageProps<C>) {
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState<RecordRange>(defaultRange);
  const [deleting, setDeleting] = useState<RecordOf<C> | null>(null);

  const openCreate = useQuickRecordStore((state) => state.openCreate);
  const openEdit = useQuickRecordStore((state) => state.openEdit);
  const openDuplicate = useQuickRecordStore((state) => state.openDuplicate);

  const querySubtype = filter === 'all' ? (allSubtypeFilter ?? 'all') : filter;
  const listQuery = useRecordListQuery(category, { subtype: querySubtype, range });
  const deleteMutation = useDeleteRecordMutation();

  const { items, total, dailySummaries } = flattenInfiniteList(listQuery.data);
  const groups = groupItemsByDateKey(items, getDateKey);

  function handleOpenCreate() {
    openCreate(category, filter === 'all' ? undefined : filter);
  }

  async function handleConfirmDelete() {
    if (!deleting || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync({ category, id: deleting.id });
      toast.success(deleteSuccessToast);
      setDeleting(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

  return (
    <>
      <ListPageCard
        title={title}
        badge={
          <span className={cn('flex size-7 items-center justify-center rounded-lg', badgeClassName)}>
            <Icon className="size-4" strokeWidth={1.8} />
          </span>
        }
        headerAction={
          <Button size="sm" onClick={handleOpenCreate}>
            <PlusIcon className="size-4" />
            {createButtonLabel}
          </Button>
        }
        filters={
          <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
            <TabsList>
              {subtypeTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        actions={<RangeFilterPills value={range} onChange={setRange} />}
      >
        {listQuery.isLoading ? (
          <RecordListSkeleton />
        ) : listQuery.isError && items.length === 0 ? (
          <RecordListError
            message={listQuery.error instanceof Error ? listQuery.error.message : loadErrorFallback}
            onRetry={() => void listQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <LittleMoments className="max-w-44" />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
            <EmptyActions>
              <Button onClick={handleOpenCreate}>
                <Icon className="size-4" />
                {createButtonLabel}
              </Button>
              {range !== 'all' ? (
                <Button variant="outline" onClick={() => setRange('all')}>
                  查看全部时间
                </Button>
              ) : null}
            </EmptyActions>
          </Empty>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <RecordDayGroup
                key={group.dateKey}
                dateKey={group.dateKey}
                summary={formatDailySummary(dailySummaries[group.dateKey])}
              >
                {group.items.map((rec) => {
                  const row = describeRow(rec);
                  return (
                    <RecordRowCard
                      key={rec.id}
                      timeLabel={row.timeLabel}
                      badge={<Badge variant={row.badgeVariant ?? category}>{row.badge}</Badge>}
                      title={row.title}
                      subtitle={row.subtitle}
                      note={rec.note}
                      onEdit={() => openEdit(toEditableRecord(category, rec))}
                      onDuplicate={() => openDuplicate(toEditableRecord(category, rec))}
                      onDelete={() => setDeleting(rec)}
                    />
                  );
                })}
              </RecordDayGroup>
            ))}

            {listQuery.isFetchNextPageError ? (
              <div className="flex flex-col items-center gap-2 pt-1 text-center">
                <p className="text-xs text-destructive">
                  {listQuery.error instanceof Error ? listQuery.error.message : '加载更多失败，请重试'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  <RotateCw className="size-3.5" />
                  {listQuery.isFetchingNextPage ? '加载中…' : '重试加载更多'}
                </Button>
              </div>
            ) : listQuery.hasNextPage ? (
              <div className="flex justify-center pt-1">
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
        title={deleteDialogTitle}
        description={deleting ? formatDeleteDescription(deleting) : ''}
        confirmLabel={deleteMutation.isPending ? '正在删除…' : '确认删除'}
        pending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
