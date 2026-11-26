import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import { TimePicker } from '@/components/ui/time-picker';
import { cn } from '@/lib/utils';

interface DateTimeInputRowProps {
  readonly dateValue: string;
  readonly timeValue: string;
  readonly minDate?: string;
  readonly maxDate?: string;
  readonly dateId?: string;
  readonly timeId?: string;
  readonly dateLabel?: string;
  readonly timeLabel?: string;
  readonly dateAriaLabel: string;
  readonly timeAriaLabel: string;
  readonly datePlaceholder?: string;
  readonly timePlaceholder?: string;
  readonly timeClearable?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onDateChange: (nextDate: string) => void;
  readonly onTimeChange: (nextTime: string) => void;
}

/**
 * 通用日期 + 时间并排输入行：
 * 统一快捷记录、睡眠起止与疫苗预约的日期时间选择布局，两端均采用跨端一致的 DatePicker / TimePicker。
 */
export function DateTimeInputRow({
  dateValue,
  timeValue,
  minDate,
  maxDate,
  dateId,
  timeId,
  dateLabel,
  timeLabel,
  dateAriaLabel,
  timeAriaLabel,
  datePlaceholder,
  timePlaceholder,
  timeClearable = false,
  disabled = false,
  className,
  onDateChange,
  onTimeChange,
}: DateTimeInputRowProps) {
  const dateControl = (
    <DatePicker
      id={dateId}
      value={dateValue}
      min={minDate}
      max={maxDate}
      placeholder={datePlaceholder}
      disabled={disabled}
      ariaLabel={dateAriaLabel}
      drawerTitle={dateLabel ?? dateAriaLabel}
      onChange={onDateChange}
    />
  );

  const timeControl = (
    <TimePicker
      id={timeId}
      value={timeValue}
      placeholder={timePlaceholder}
      clearable={timeClearable}
      disabled={disabled}
      ariaLabel={timeAriaLabel}
      drawerTitle={timeLabel ?? timeAriaLabel}
      onChange={onTimeChange}
    />
  );

  return (
    <div
      className={cn('grid grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-2.5', className)}
    >
      {dateLabel ? (
        <Field>
          <FieldLabel htmlFor={dateId}>{dateLabel}</FieldLabel>
          {dateControl}
        </Field>
      ) : (
        dateControl
      )}

      {timeLabel ? (
        <Field>
          <FieldLabel htmlFor={timeId}>{timeLabel}</FieldLabel>
          {timeControl}
        </Field>
      ) : (
        timeControl
      )}
    </div>
  );
}
