import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { type RelativeTimeChip, shiftBatchDateStr } from '@/components/batch-record/batch-codec';
import { DateTimeInputRow } from '@/components/date-time-input-row';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { QuickChip } from '@/components/ui/choice-controls';
import { formatShortCnDate } from '@/lib/time';

interface BatchTimeSectionProps {
  readonly dateStr: string;
  readonly timeStr: string;
  readonly todayMaxDate: string;
  readonly yesterdayDate: string;
  readonly lastSubmittedTimeStr: string | null;
  readonly relativeTimeChips: readonly RelativeTimeChip[];
  readonly isDuplicateSessionTime: boolean;
  readonly disabled: boolean;
  readonly onDateChange: (nextDate: string) => void;
  readonly onTimeChange: (nextTime: string) => void;
  readonly onDateTimeChange: (nextDate: string, nextTime: string) => void;
}

/** 批量补录统一日期时间区块：常驻展开，含昨日/今日与前后翻日、连续补录快捷跳时胶囊及重复时间提醒。 */
export function BatchTimeSection({
  dateStr,
  timeStr,
  todayMaxDate,
  yesterdayDate,
  lastSubmittedTimeStr,
  relativeTimeChips,
  isDuplicateSessionTime,
  disabled,
  onDateChange,
  onTimeChange,
  onDateTimeChange,
}: BatchTimeSectionProps) {
  return (
    <section aria-label="记录时间" className="space-y-2.5 rounded-2xl border border-border/75 bg-muted/20 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <CalendarClock className="size-4 text-primary" aria-hidden="true" strokeWidth={1.8} />
          <span>记录时间</span>
        </div>

        <div className="flex items-center gap-1">
          <QuickChip
            variant="outline"
            active={dateStr === yesterdayDate}
            disabled={disabled}
            onClick={() => onDateChange(yesterdayDate)}
          >
            昨天
          </QuickChip>
          <QuickChip
            variant="outline"
            active={dateStr === todayMaxDate}
            disabled={disabled}
            onClick={() => onDateChange(todayMaxDate)}
          >
            今天
          </QuickChip>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={disabled}
            aria-label="前一天"
            onClick={() => onDateChange(shiftBatchDateStr(dateStr, -1, todayMaxDate))}
            className="size-8 rounded-full sm:size-7"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={disabled || dateStr >= todayMaxDate}
            aria-label="后一天"
            onClick={() => onDateChange(shiftBatchDateStr(dateStr, 1, todayMaxDate))}
            className="size-8 rounded-full sm:size-7"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <DateTimeInputRow
        dateId="batch-record-date"
        timeId="batch-record-time"
        dateValue={dateStr}
        timeValue={timeStr}
        maxDate={todayMaxDate}
        dateAriaLabel="补录日期"
        timeAriaLabel="补录时间"
        timePlaceholder="选择时间"
        disabled={disabled}
        onDateChange={onDateChange}
        onTimeChange={onTimeChange}
      />

      {lastSubmittedTimeStr && relativeTimeChips.length > 0 ? (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <p className="text-xs text-muted-foreground tabular-nums">按上次 {lastSubmittedTimeStr} 推算：</p>
          <div className="flex flex-wrap gap-1.5">
            {relativeTimeChips.map((chip) => (
              <QuickChip
                key={chip.offsetHours}
                variant="outline"
                disabled={disabled}
                active={dateStr === chip.dateStr && timeStr === chip.timeStr}
                onClick={() => onDateTimeChange(chip.dateStr, chip.timeStr)}
              >
                {chip.label}
              </QuickChip>
            ))}
          </div>
        </div>
      ) : null}

      {isDuplicateSessionTime ? (
        <Alert variant="warning" size="compact">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {formatShortCnDate(dateStr, todayMaxDate)} {timeStr} 刚才已补录过，请确认是否继续补充。
          </span>
        </Alert>
      ) : null}
    </section>
  );
}
