import { AlertCircle, CopyPlus, PencilIcon, RotateCw, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { RANGE_LABELS, type RecordRange } from '@/lib/records';
import { formatDateGroupLabel } from '@/lib/time';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS: ReadonlyArray<RecordRange> = ['today', '7d', '30d', 'all'];

export function RangeFilterPills({
  value,
  onChange,
}: {
  readonly value: RecordRange;
  readonly onChange: (next: RecordRange) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0" aria-label="时间范围筛选">
      {RANGE_OPTIONS.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={value === range}
          onClick={() => onChange(range)}
          className={cn(
            'cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === range
              ? 'border-primary bg-accent font-medium text-accent-foreground'
              : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
          )}
        >
          {RANGE_LABELS[range]}
        </button>
      ))}
    </fieldset>
  );
}

export interface GroupedDay<T> {
  readonly dateKey: string;
  readonly items: readonly T[];
}

export function groupItemsByDateKey<T>(items: readonly T[], getDateKey: (item: T) => string): GroupedDay<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getDateKey(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries()).map(([dateKey, grouped]) => ({ dateKey, items: grouped }));
}

export function RecordListSkeleton() {
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

export function RecordListError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
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

export function RecordDayGroup({
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

export function RecordRowCard({
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
