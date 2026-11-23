import { Input } from '@/components/ui/input';

interface DateTimeInputRowProps {
  readonly dateValue: string;
  readonly timeValue: string;
  readonly maxDate: string;
  readonly dateAriaLabel: string;
  readonly timeAriaLabel: string;
  readonly onDateChange: (nextDate: string) => void;
  readonly onTimeChange: (nextTime: string) => void;
}

/**
 * 日期与时间并排输入行：
 * 中文日期文本（如「2026年11月23日」）宽度明显大于时间文本，
 * 在 360px 以上采用 3:2 比例列宽避免 iOS 原生日期控件挤压或重叠，极窄屏自动折行堆叠。
 */
export function DateTimeInputRow({
  dateValue,
  timeValue,
  maxDate,
  dateAriaLabel,
  timeAriaLabel,
  onDateChange,
  onTimeChange,
}: DateTimeInputRowProps) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-2.5">
      <Input
        type="date"
        max={maxDate}
        value={dateValue}
        aria-label={dateAriaLabel}
        className="tabular-nums"
        onChange={(event) => onDateChange(event.target.value)}
      />
      <Input
        type="time"
        value={timeValue}
        aria-label={timeAriaLabel}
        className="tabular-nums"
        onChange={(event) => onTimeChange(event.target.value)}
      />
    </div>
  );
}
