import { subMinutes } from 'date-fns';
import { DateTimeInputRow } from '@/components/quick-record/date-time-input-row';
import { QuickChip } from '@/components/quick-record/record-controls';
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
      <DateTimeInputRow
        dateValue={dateStr}
        timeValue={timeStr}
        maxDate={maxDate}
        dateAriaLabel="记录日期"
        timeAriaLabel="记录时间"
        onDateChange={(nextDate) => onChange(nextDate, timeStr)}
        onTimeChange={(nextTime) => onChange(dateStr, nextTime)}
      />
      <div className="flex flex-wrap gap-1.5">
        {TIME_OFFSETS.map((item) => (
          <QuickChip key={item.label} onClick={() => applyOffset(item.minutes)}>
            {item.label}
          </QuickChip>
        ))}
      </div>
    </div>
  );
}
