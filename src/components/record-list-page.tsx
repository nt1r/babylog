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
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { useOverlayStore } from '@/stores/overlays';

const DEFAULT_RANGE_OPTIONS: ReadonlyArray<RecordRange> = ['today', '7d', '30d', 'all'];

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
  options,
  value,
  onChange,
}: {
  readonly options: readonly RecordRange[];
  readonly value: RecordRange;
  readonly onChange: (next: RecordRange) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0" aria-label="时间范围筛选">
      {options.map((range) => (
        <QuickChip key={range} variant="outline" active={value === range} onClick={() => onChange(range)}>
          {RANGE_LABELS[range]}
        </QuickChip>
      ))}
    </fieldset>
  );
}

function RecordListSkeleton({ flat = false }: { readonly flat?: boolean }) {
  if (flat) {
    return (
      <div className="space-y-2.5">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

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

const TIMELINE_DOT_CLASS: Record<RecordCategory | 'warning' | 'destructive', string> = {
  feeding: 'bg-feeding',
  sleep: 'bg-sleep',
  care: 'bg-care',
  health: 'bg-health',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

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
      <div className="relative space-y-2 pl-5 before:pointer-events-none before:absolute before:top-4 before:bottom-4 before:left-[0.4375rem] before:w-px before:bg-border/80">
        {children}
      </div>
    </section>
  );
}

function RecordRowCard({
  timeLabel,
  timeLabelClassName,
  showTimelineDot = true,
  dotTone,
  badge,
  title,
  subtitle,
  note,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  readonly timeLabel: string;
  readonly timeLabelClassName?: string;
  readonly showTimelineDot?: boolean;
  readonly dotTone: RecordCategory | 'warning' | 'destructive';
  readonly badge: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly note?: string;
  readonly onEdit: () => void;
  readonly onDuplicate?: () => void;
  readonly onDelete: () => void;
}) {
  const card = (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-background/60 px-3.5 py-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn('mt-0.5 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums', timeLabelClassName)}
        >
          {timeLabel}
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            <span className="text-sm font-medium text-foreground tabular-nums">{title}</span>
          </div>
          {subtitle ? <p className="text-xs text-muted-foreground tabular-nums">{subtitle}</p> : null}
          {note ? <p className="line-clamp-2 text-xs text-muted-foreground/90">备注：{note}</p> : null}
        </div>
      </button>

      {/* 放大触控面积并在编辑与删除之间拉大安全间距，降低移动端单手误触删除风险 */}
      <div className="flex shrink-0 items-center justify-end gap-2">
        {onDuplicate ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onDuplicate}
                  className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:h-8"
                />
              }
            >
              <CopyPlus className="size-3.5" />
              再记一笔
            </TooltipTrigger>
            <TooltipContent>以当前时间再记一笔相同内容</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="编辑记录"
                onClick={onEdit}
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
                onClick={onDelete}
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

  if (!showTimelineDot) {
    return card;
  }

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-4.5 -left-[1.125rem] size-2.5 rounded-full ring-[3px] ring-card',
          TIMELINE_DOT_CLASS[dotTone],
        )}
      />
      {card}
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

interface RecordListPageBaseProps<C extends RecordCategory> {
  readonly category: C;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly badgeClassName: string;
  readonly createButtonLabel: string;
  readonly defaultRange?: RecordRange;
  readonly rangeOptions?: readonly RecordRange[];
  readonly allSubtypeFilter?: string;
  readonly subtypeTabs: readonly SubtypeTabOption[];
  readonly loadErrorFallback: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly deleteDialogTitle: string;
  readonly deleteSuccessToast: string;
  readonly describeRow: (rec: RecordOf<C>) => RecordRowDescriptor;
  readonly formatDeleteDescription: (rec: RecordOf<C>) => string;
  readonly secondaryHeaderAction?: ReactNode;
  readonly onCreate?: (activeFilter: string) => void;
  readonly onEdit?: (rec: RecordOf<C>) => void;
}

type RecordListPageProps<C extends RecordCategory> = RecordListPageBaseProps<C> &
  (
    | {
        readonly layout?: 'grouped';
        readonly getDateKey: (rec: RecordOf<C>) => string;
        readonly formatDailySummary: (sum?: DailySummaryOf<C>) => string;
      }
    | {
        readonly layout: 'flat';
        readonly getDateKey?: never;
        readonly formatDailySummary?: never;
      }
  );

/**
 * 统一记录列表页深模块：同时支持按自然日分组（喂养/睡眠/护理/健康）与按纯日期平铺（生长发育）两种模式，
 * 收拢子类型筛选、时间范围、无限分页、失败重试、新建/编辑回调与删除确认弹窗，各路由仅声明业务配置与行格式化函数。
 */
export function RecordListPage<C extends RecordCategory>(props: RecordListPageProps<C>) {
  const {
    category,
    title,
    icon: Icon,
    badgeClassName,
    createButtonLabel,
    defaultRange = '7d',
    rangeOptions = DEFAULT_RANGE_OPTIONS,
    allSubtypeFilter,
    subtypeTabs,
    loadErrorFallback,
    emptyTitle,
    emptyDescription,
    deleteDialogTitle,
    deleteSuccessToast,
    describeRow,
    formatDeleteDescription,
    secondaryHeaderAction,
    onCreate,
    onEdit,
  } = props;
  const isFlat = props.layout === 'flat';
  // 仅默认分组列表且走快捷记录抽屉时展示「再记一笔」，避免自定义编辑抽屉（如生长发育）误触发 QuickRecordDrawer。
  const enableDuplicate = !isFlat && !onEdit;

  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState<RecordRange>(defaultRange);
  const [deleting, setDeleting] = useState<RecordOf<C> | null>(null);

  const querySubtype = filter === 'all' ? (allSubtypeFilter ?? 'all') : filter;
  const listQuery = useRecordListQuery(category, { subtype: querySubtype, range });
  const deleteMutation = useDeleteRecordMutation();

  const { items, total, dailySummaries } = flattenInfiniteList(listQuery.data);
  const groups = props.layout === 'flat' ? [] : groupItemsByDateKey(items, props.getDateKey);

  function handleOpenCreate() {
    if (onCreate) {
      onCreate(filter);
      return;
    }
    useOverlayStore.getState().openQuickCreate(category, filter === 'all' ? undefined : filter);
  }

  function handleEdit(rec: RecordOf<C>) {
    if (onEdit) {
      onEdit(rec);
      return;
    }
    useOverlayStore.getState().openQuickEdit(toEditableRecord(category, rec));
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

  function renderRow(rec: RecordOf<C>) {
    const row = describeRow(rec);
    return (
      <RecordRowCard
        key={rec.id}
        timeLabel={row.timeLabel}
        timeLabelClassName={isFlat ? 'min-w-16' : undefined}
        showTimelineDot={!isFlat}
        dotTone={row.badgeVariant ?? category}
        badge={<Badge variant={row.badgeVariant ?? category}>{row.badge}</Badge>}
        title={row.title}
        subtitle={row.subtitle}
        note={rec.note}
        onEdit={() => handleEdit(rec)}
        onDuplicate={
          enableDuplicate
            ? () => useOverlayStore.getState().openQuickDuplicate(toEditableRecord(category, rec))
            : undefined
        }
        onDelete={() => setDeleting(rec)}
      />
    );
  }

  const paginationFooter = listQuery.isFetchNextPageError ? (
    <div className={cn('flex flex-col items-center gap-2 text-center', isFlat ? 'pt-2' : 'pt-1')}>
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
    <div className={cn('flex justify-center', isFlat ? 'pt-2' : 'pt-1')}>
      <Button
        variant="outline"
        size="sm"
        disabled={listQuery.isFetchingNextPage}
        onClick={() => void listQuery.fetchNextPage()}
      >
        {listQuery.isFetchingNextPage ? '加载中…' : `加载更多（已显示 ${items.length} / ${total}）`}
      </Button>
    </div>
  ) : null;

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
          <div className="flex items-center gap-2">
            {secondaryHeaderAction}
            <Button size="sm" onClick={handleOpenCreate}>
              <PlusIcon className="size-4" />
              {createButtonLabel}
            </Button>
          </div>
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
        actions={<RangeFilterPills options={rangeOptions} value={range} onChange={setRange} />}
      >
        {listQuery.isLoading ? (
          <RecordListSkeleton flat={isFlat} />
        ) : listQuery.isError && items.length === 0 ? (
          <RecordListError
            message={listQuery.error instanceof Error ? listQuery.error.message : loadErrorFallback}
            onRetry={() => void listQuery.refetch()}
          />
        ) : items.length === 0 ? (
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
        ) : props.layout === 'flat' ? (
          <div className="space-y-2">
            {items.map((rec) => renderRow(rec))}
            {paginationFooter}
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <RecordDayGroup
                key={group.dateKey}
                dateKey={group.dateKey}
                summary={props.formatDailySummary(dailySummaries[group.dateKey])}
              >
                {group.items.map((rec) => renderRow(rec))}
              </RecordDayGroup>
            ))}
            {paginationFooter}
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
