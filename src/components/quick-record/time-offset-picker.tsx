import { subMinutes } from 'date-fns';
import { Input } from '@/components/ui/input';
import { splitLocalDateTime } from '@/lib/time';

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
  readonly onChange: (nextDate: string, nextTime: string) => void;
}

/** 日期 + 时间组合选择器，附带相对时间偏移胶囊，方便补录刚完成的照护而无需滚动时间滚轮。 */
export function TimeOffsetPicker({ dateStr, timeStr, maxDate, onChange }: TimeOffsetPickerProps) {
  function applyOffset(minutesAgo: number) {
    const dt = splitLocalDateTime(subMinutes(new Date(), minutesAgo));
    onChange(dt.date, dt.time);
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-foreground">记录时间</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Input
          type="date"
          max={maxDate}
          value={dateStr}
          aria-label="记录日期"
          className="tabular-nums"
          onChange={(event) => onChange(event.target.value, timeStr)}
        />
        <Input
          type="time"
          value={timeStr}
          aria-label="记录时间"
          className="tabular-nums"
          onChange={(event) => onChange(dateStr, event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TIME_OFFSETS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => applyOffset(item.minutes)}
            className="cursor-pointer rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
