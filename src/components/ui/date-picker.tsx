import { CalendarDays } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { Matcher } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { PickerShell } from '@/components/ui/picker-shell';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatLocalDateKey, isDateKeyWithinBounds, parseLocalDateKey, resolveInitialCalendarMonth } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface DatePickerProps {
  readonly id?: string;
  /** 受控日期值，格式为 YYYY-MM-DD；为空字符串时展示占位提示。 */
  readonly value: string;
  readonly onChange: (nextDate: string) => void;
  readonly min?: string;
  readonly max?: string;
  readonly placeholder?: string;
  readonly size?: 'default' | 'sm';
  readonly captionLayout?: 'label' | 'dropdown';
  readonly clearable?: boolean;
  readonly showTodayAction?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly ariaLabel?: string;
  /** 移动端底部抽屉标题，缺省时回退到 ariaLabel 或「选择日期」。 */
  readonly drawerTitle?: string;
  readonly className?: string;
}

/**
 * 统一跨端日期选择器：
 * 触发器全端等宽展示 YYYY-MM-DD；桌面端以 Popover 锚定弹出，移动端以 @base-ui/react/drawer
 * 底部抽屉呈现（在 EntityDrawer 内部自动参与嵌套抽屉堆栈）。
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = '选择日期',
  size = 'default',
  captionLayout = 'label',
  clearable = false,
  showTodayAction = true,
  disabled = false,
  invalid = false,
  ariaLabel,
  drawerTitle,
  className,
}: DatePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const selectedDate = useMemo(() => parseLocalDateKey(value), [value]);
  const [displayMonth, setDisplayMonth] = useState<Date>(() => resolveInitialCalendarMonth(selectedDate, min, max));

  const disabledMatcher = useMemo<Matcher | Matcher[] | undefined>(() => {
    const matchers: Matcher[] = [];
    const minDate = min ? parseLocalDateKey(min) : undefined;
    const maxDate = max ? parseLocalDateKey(max) : undefined;
    if (minDate) matchers.push({ before: minDate });
    if (maxDate) matchers.push({ after: maxDate });
    if (matchers.length === 0) return undefined;
    return matchers.length === 1 ? matchers[0] : matchers;
  }, [min, max]);

  const { startMonth, endMonth } = useMemo(() => {
    const now = new Date();
    const minDate = min ? parseLocalDateKey(min) : undefined;
    const maxDate = max ? parseLocalDateKey(max) : undefined;
    // 未指定 min/max 时以当前年 [-15, +12] 为下拉年份兜底范围，并向已选年份自动扩界防止无法回显。
    const fallbackStartYear = Math.min(now.getFullYear() - 15, selectedDate?.getFullYear() ?? now.getFullYear());
    const fallbackEndYear = Math.max(now.getFullYear() + 12, selectedDate?.getFullYear() ?? now.getFullYear());
    return {
      startMonth: minDate ? new Date(minDate.getFullYear(), minDate.getMonth(), 1) : new Date(fallbackStartYear, 0, 1),
      endMonth: maxDate ? new Date(maxDate.getFullYear(), maxDate.getMonth(), 1) : new Date(fallbackEndYear, 11, 1),
    };
  }, [min, max, selectedDate]);

  const canPickToday = showTodayAction && isDateKeyWithinBounds(formatLocalDateKey(new Date()), min, max);
  const showInlineClear = clearable && Boolean(value) && !disabled;
  const displayText = selectedDate ? value : placeholder;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setDisplayMonth(resolveInitialCalendarMonth(selectedDate, min, max));
      }
      setOpen(nextOpen);
    },
    [selectedDate, min, max],
  );

  function handleSelect(nextDate: Date | undefined) {
    if (!nextDate) {
      if (clearable) {
        onChange('');
      }
      setOpen(false);
      return;
    }
    onChange(formatLocalDateKey(nextDate));
    setOpen(false);
  }

  function handlePickToday() {
    const now = new Date();
    const freshTodayKey = formatLocalDateKey(now);
    // 点击瞬间按最新时间复核 [min, max]，避免面板跨午夜停放后绕过上界限制。
    if (!isDateKeyWithinBounds(freshTodayKey, min, max)) return;
    setDisplayMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    onChange(freshTodayKey);
    setOpen(false);
  }

  function handleClear() {
    onChange('');
    setOpen(false);
  }

  const footer =
    canPickToday || (clearable && Boolean(value)) ? (
      <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <div className="flex items-center gap-1.5">
          {canPickToday ? (
            <Button type="button" variant="secondary" size="sm" onClick={handlePickToday}>
              今天
            </Button>
          ) : null}
        </div>
        {clearable && value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleClear}
          >
            清空
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <PickerShell
      id={id}
      isMobile={isMobile}
      open={open}
      onOpenChange={handleOpenChange}
      disabled={disabled}
      invalid={invalid}
      size={size}
      displayText={displayText}
      hasValue={Boolean(selectedDate)}
      ariaLabel={ariaLabel}
      drawerTitle={drawerTitle ?? ariaLabel ?? '选择日期'}
      closeAriaLabel="关闭日期选择"
      clearAriaLabel="清除日期"
      showInlineClear={showInlineClear}
      onClear={handleClear}
      trailingIcon={
        <CalendarDays
          aria-hidden="true"
          className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'size-3.5' : 'size-4')}
        />
      }
      className={className}
      footer={footer}
    >
      <Calendar
        mode="single"
        required={!clearable}
        selected={selectedDate}
        month={displayMonth}
        onMonthChange={setDisplayMonth}
        onSelect={handleSelect}
        disabled={disabledMatcher}
        captionLayout={captionLayout}
        startMonth={startMonth}
        endMonth={endMonth}
        className={isMobile ? 'w-full max-w-[19.5rem] p-1 [--cell-size:--spacing(9)]' : 'p-0.5'}
      />
    </PickerShell>
  );
}
