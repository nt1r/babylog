import { subMinutes } from 'date-fns';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DateTimeInputRow } from '@/components/date-time-input-row';
import { QuickChip } from '@/components/ui/choice-controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatLocalDateKey, splitLocalDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const TIME_OFFSETS = [
  { label: '刚刚', minutes: 0 },
  { label: '15 分钟前', minutes: 15 },
  { label: '30 分钟前', minutes: 30 },
  { label: '1 小时前', minutes: 60 },
] as const;

interface TimeOffsetPickerProps {
  readonly dateStr: string;
  readonly timeStr: string;
  readonly maxDate: string;
  /** 编辑历史记录时可默认展开完整日期时间选择器；新建态默认收起以缩短抽屉首屏高度。 */
  readonly defaultExpanded?: boolean;
  /** 抽屉重新打开或切换记录目标时变化的复位键，确保上次手动展开态不残留。 */
  readonly resetKey?: string;
  readonly onChange: (nextDate: string, nextTime: string) => void;
}

function formatCompactDateTimeLabel(dateStr: string, timeStr: string): string {
  const todayKey = formatLocalDateKey(new Date());
  const timePart = timeStr || '--:--';
  if (!dateStr || dateStr === todayKey) {
    return `今天 ${timePart}`;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return `${dateStr} ${timePart}`;
  const currentYear = new Date().getFullYear();
  return y === currentYear ? `${m}月${d}日 ${timePart}` : `${y}年${m}月${d}日 ${timePart}`;
}

/**
 * 渐进披露式记录时间选择器：
 * 新建态默认单行展示当前时间摘要与快捷偏移胶囊，点击「自选时间」才展开完整日期时间选择器，
 * 减少移动端频繁录入时的滚动距离。
 */
export function TimeOffsetPicker({
  dateStr,
  timeStr,
  maxDate,
  defaultExpanded = false,
  resetKey,
  onChange,
}: TimeOffsetPickerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    // 借 resetKey 变更显式重置折叠区展开态，避免切换抽屉意图或重开后残留上次手动展开状态。
    void resetKey;
    setExpanded(defaultExpanded);
  }, [defaultExpanded, resetKey]);

  function applyOffset(minutesAgo: number) {
    const dt = splitLocalDateTime(subMinutes(new Date(), minutesAgo));
    onChange(dt.date, dt.time);
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="space-y-2 rounded-2xl border border-border/75 bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <CalendarClock className="size-3.5 text-primary" aria-hidden="true" strokeWidth={1.8} />
          <span>记录时间</span>
          <span className="rounded-md bg-background/85 px-2 py-0.5 text-xs font-semibold text-foreground tabular-nums ring-1 ring-border/70">
            {formatCompactDateTimeLabel(dateStr, timeStr)}
          </span>
        </div>

        <CollapsibleTrigger
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
            expanded
              ? 'border-primary/45 bg-accent/70 text-accent-foreground'
              : 'border-border/80 bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground',
          )}
        >
          <span>{expanded ? '收起自选' : '自选时间'}</span>
          <ChevronDown className="size-3.5 transition-transform duration-200 group-data-panel-open/collapsible-trigger:rotate-180" />
        </CollapsibleTrigger>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TIME_OFFSETS.map((item) => (
          <QuickChip key={item.label} variant="outline" onClick={() => applyOffset(item.minutes)}>
            {item.label}
          </QuickChip>
        ))}
      </div>

      <CollapsibleContent>
        <div className="border-t border-border/60 pt-2.5">
          <DateTimeInputRow
            dateValue={dateStr}
            timeValue={timeStr}
            maxDate={maxDate}
            dateAriaLabel="记录日期"
            timeAriaLabel="记录时间"
            onDateChange={(nextDate) => onChange(nextDate, timeStr)}
            onTimeChange={(nextTime) => onChange(dateStr, nextTime)}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
