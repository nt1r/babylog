import { ClockIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PickerShell } from '@/components/ui/picker-shell';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatLocalTimeKey, parseLocalTimeKey } from '@/lib/time';
import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 24 }, (_, idx) => idx);
const MINUTES = Array.from({ length: 60 }, (_, idx) => idx);

export interface TimePickerProps {
  readonly id?: string;
  /** 受控时间值，格式为 HH:mm；为空字符串时展示占位提示。 */
  readonly value: string;
  readonly onChange: (nextTime: string) => void;
  readonly placeholder?: string;
  readonly size?: 'default' | 'sm';
  readonly clearable?: boolean;
  readonly showNowAction?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly ariaLabel?: string;
  /** 移动端底部抽屉标题，缺省时回退到 ariaLabel 或「选择时间」。 */
  readonly drawerTitle?: string;
  readonly className?: string;
}

function scrollColumnToActive(container: HTMLDivElement | null) {
  if (!container) return;
  const activeBtn = container.querySelector<HTMLElement>('[data-active="true"]');
  if (!activeBtn) return;
  const offset = activeBtn.offsetTop - container.clientHeight / 2 + activeBtn.clientHeight / 2;
  container.scrollTop = Math.max(0, offset);
}

/**
 * 统一跨端时间选择器：
 * 全端统一 24 小时制等宽 HH:mm 展示与双列时/分选择，彻底消除 iOS 12 小时制文案差异与可选时间难清空问题；
 * 桌面端以 Popover 弹出，移动端以 @base-ui/react/drawer 底部抽屉呈现并自动参与嵌套抽屉堆栈。
 */
export function TimePicker({
  id,
  value,
  onChange,
  placeholder = '选择时间',
  size = 'default',
  clearable = false,
  showNowAction = true,
  disabled = false,
  invalid = false,
  ariaLabel,
  drawerTitle,
  className,
}: TimePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseLocalTimeKey(value), [value]);
  const showInlineClear = clearable && Boolean(value) && !disabled;
  const displayText = parsed ? value : placeholder;

  // 打开面板或跨断点切换容器时，将已选小时与分钟滚动到各自列表中间，减少翻找步数。
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      scrollColumnToActive(hourListRef.current);
      scrollColumnToActive(minuteListRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, isMobile]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  function handleSelectHour(hour: number) {
    const wasEmpty = !parsed;
    const minute = parsed?.minute ?? 0;
    onChange(formatLocalTimeKey(hour, minute));
    if (wasEmpty) {
      window.requestAnimationFrame(() => scrollColumnToActive(minuteListRef.current));
    }
  }

  function handleSelectMinute(minute: number) {
    const wasEmpty = !parsed;
    const hour = parsed?.hour ?? new Date().getHours();
    onChange(formatLocalTimeKey(hour, minute));
    // 空值先选分钟时会自动补齐当前小时，补滚小时列让自动选中的小时可见。
    if (wasEmpty) {
      window.requestAnimationFrame(() => scrollColumnToActive(hourListRef.current));
    }
  }

  function handlePickNow() {
    const now = new Date();
    onChange(formatLocalTimeKey(now.getHours(), now.getMinutes()));
    setOpen(false);
  }

  function handleClear() {
    onChange('');
    setOpen(false);
  }

  function resolvePopoverInitialFocus() {
    return hourListRef.current?.querySelector<HTMLElement>('[data-active="true"]') ?? true;
  }

  const footer = (
    <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
      <div className="flex items-center gap-1.5">
        {showNowAction ? (
          <Button type="button" variant="secondary" size="sm" onClick={handlePickNow}>
            此刻
          </Button>
        ) : null}
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
      <Button type="button" size="sm" onClick={() => setOpen(false)}>
        确定
      </Button>
    </div>
  );

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
      hasValue={Boolean(parsed)}
      ariaLabel={ariaLabel}
      drawerTitle={drawerTitle ?? ariaLabel ?? '选择时间'}
      closeAriaLabel="关闭时间选择"
      clearAriaLabel="清除时间"
      showInlineClear={showInlineClear}
      onClear={handleClear}
      trailingIcon={
        <ClockIcon
          aria-hidden="true"
          className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'size-3.5' : 'size-4')}
        />
      }
      popoverInitialFocus={resolvePopoverInitialFocus}
      focusMobileCloseButton
      className={className}
      footer={footer}
    >
      <div
        data-base-ui-swipe-ignore=""
        className={cn(
          'grid grid-cols-2 divide-x divide-border/70 rounded-xl border border-border/75 bg-background/60',
          isMobile ? 'w-full max-w-[19.5rem]' : 'w-48',
        )}
      >
        <fieldset aria-label="小时" className="flex min-w-0 flex-col border-0 p-0">
          <div className="border-b border-border/60 py-1.5 text-center text-xs font-medium text-muted-foreground">
            时
          </div>
          <div
            ref={hourListRef}
            className={cn(
              'relative flex flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5',
              isMobile ? 'h-56' : 'h-52',
            )}
          >
            {HOURS.map((hour) => {
              const active = parsed?.hour === hour;
              const label = String(hour).padStart(2, '0');
              return (
                <button
                  key={hour}
                  type="button"
                  data-active={active ? 'true' : undefined}
                  aria-label={`${label} 时`}
                  aria-pressed={active}
                  onClick={() => handleSelectHour(hour)}
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isMobile ? 'h-10' : 'h-8',
                    active
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset aria-label="分钟" className="flex min-w-0 flex-col border-0 p-0">
          <div className="border-b border-border/60 py-1.5 text-center text-xs font-medium text-muted-foreground">
            分
          </div>
          <div
            ref={minuteListRef}
            className={cn(
              'relative flex flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5',
              isMobile ? 'h-56' : 'h-52',
            )}
          >
            {MINUTES.map((minute) => {
              const active = parsed?.minute === minute;
              const label = String(minute).padStart(2, '0');
              return (
                <button
                  key={minute}
                  type="button"
                  data-active={active ? 'true' : undefined}
                  aria-label={`${label} 分`}
                  aria-pressed={active}
                  onClick={() => handleSelectMinute(minute)}
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isMobile ? 'h-10' : 'h-8',
                    active
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </PickerShell>
  );
}
