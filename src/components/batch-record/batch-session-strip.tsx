import { CheckCircle2, ChevronDown, RotateCcw } from 'lucide-react';
import type { BatchSessionEntry } from '@/components/batch-record/batch-codec';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { formatShortCnDate } from '@/lib/time';

interface BatchSessionStripProps {
  readonly entries: readonly BatchSessionEntry[];
  readonly open: boolean;
  readonly todayMaxDate: string;
  readonly isBusy: boolean;
  readonly undoingId: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onUndo: (entry: BatchSessionEntry) => void;
}

/** 本次批量补录会话进度条：折叠展示已录数量与最近时间点，展开支持单时间点一键撤销。 */
export function BatchSessionStrip({
  entries,
  open,
  todayMaxDate,
  isBusy,
  undoingId,
  onOpenChange,
  onUndo,
}: BatchSessionStripProps) {
  const latestEntry = entries[0];
  if (!latestEntry) return null;

  const totalRecords = entries.reduce((sum, entry) => sum + entry.targets.length, 0);

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-2xl border border-success/30 bg-success-soft/35 p-3"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success-soft-foreground">
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              本次已补录 {entries.length} 个时间点（共 {totalRecords} 条）
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            最近：{formatShortCnDate(latestEntry.dateStr, todayMaxDate)} {latestEntry.timeStr} ·{' '}
            {latestEntry.summaryLabel}
          </p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/collapsible-trigger:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2.5 space-y-1.5 border-t border-success/20 pt-2.5">
          {entries.map((entry) => {
            const undoingThis = undoingId === entry.id;
            return (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border/65 bg-card/85 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground tabular-nums">
                    {formatShortCnDate(entry.dateStr, todayMaxDate)} {entry.timeStr}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{entry.summaryLabel}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onUndo(entry)}
                  className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:bg-destructive-soft/70 hover:text-destructive"
                >
                  {undoingThis ? (
                    <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  <span>{undoingThis ? '撤销中…' : '撤销'}</span>
                </Button>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
