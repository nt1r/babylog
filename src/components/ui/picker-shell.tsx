import { XIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface PickerShellProps {
  readonly id?: string;
  readonly isMobile: boolean;
  readonly open: boolean;
  readonly onOpenChange: (nextOpen: boolean) => void;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly size: 'default' | 'sm';
  readonly displayText: string;
  readonly hasValue: boolean;
  readonly ariaLabel?: string;
  readonly drawerTitle: string;
  readonly closeAriaLabel: string;
  readonly clearAriaLabel: string;
  readonly showInlineClear: boolean;
  readonly onClear: () => void;
  readonly trailingIcon: ReactNode;
  readonly popoverInitialFocus?: ComponentProps<typeof PopoverContent>['initialFocus'];
  /** 移动端抽屉是否优先聚焦右上角关闭按钮（用于含内部滚动列表的选择器，避免进场阶段滚动跳动同时保持模态焦点合法）。 */
  readonly focusMobileCloseButton?: boolean;
  readonly className?: string;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * DatePicker 与 TimePicker 共享的跨端触发与浮层外壳：
 * 统一触发器样式、行内清除按钮、disabled 同步关闭、读屏当前值播报及桌面 Popover / 移动端嵌套 Drawer 切换。
 */
export function PickerShell({
  id,
  isMobile,
  open,
  onOpenChange,
  disabled,
  invalid,
  size,
  displayText,
  hasValue,
  ariaLabel,
  drawerTitle,
  closeAriaLabel,
  clearAriaLabel,
  showInlineClear,
  onClear,
  trailingIcon,
  popoverInitialFocus,
  focusMobileCloseButton = false,
  className,
  footer,
  children,
}: PickerShellProps) {
  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  // 面板已打开时若外部条件使控件变为 disabled，自动收起浮层避免卡死。
  useEffect(() => {
    if (disabled && open) {
      onOpenChange(false);
    }
  }, [disabled, open, onOpenChange]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && disabled) return;
    onOpenChange(nextOpen);
  }

  const triggerButton = (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      aria-label={ariaLabel ? `${ariaLabel}，${displayText}` : undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full min-w-0 justify-between border-input bg-background/60 font-normal tabular-nums shadow-none hover:bg-background/90 dark:bg-input/25 dark:hover:bg-input/40',
        size === 'sm' ? 'h-8 rounded-lg px-2.5 text-[13px]' : 'h-10 rounded-xl px-3 text-sm',
        showInlineClear && (size === 'sm' ? 'pr-7' : 'pr-8'),
        !hasValue && 'text-muted-foreground/80',
      )}
    >
      <span className="truncate">{displayText}</span>
      {!showInlineClear ? trailingIcon : null}
    </Button>
  );

  const inlineClearButton = showInlineClear ? (
    <button
      type="button"
      aria-label={clearAriaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClear();
      }}
      className={cn(
        'absolute right-1.5 z-10 inline-flex cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        size === 'sm' ? 'size-5' : 'size-6',
      )}
    >
      <XIcon className="size-3.5" />
    </button>
  ) : null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="down" showSwipeHandle>
        <div className={cn('relative flex w-full min-w-0 items-center', className)}>
          <DrawerTrigger render={triggerButton} />
          {inlineClearButton}
        </div>

        <DrawerContent initialFocus={focusMobileCloseButton ? mobileCloseRef : undefined}>
          <DrawerHeader className="flex-row items-center justify-between px-5 py-3">
            <DrawerTitle>{drawerTitle}</DrawerTitle>
            <DrawerClose
              render={
                <Button ref={mobileCloseRef} type="button" variant="ghost" size="icon-sm" aria-label={closeAriaLabel} />
              }
            >
              <XIcon className="size-4" />
            </DrawerClose>
          </DrawerHeader>

          <div className="flex flex-col items-center gap-3 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {children}
            {footer ? <div className="w-full max-w-[19.5rem]">{footer}</div> : null}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className={cn('relative flex w-full min-w-0 items-center', className)}>
        <PopoverTrigger render={triggerButton} />
        {inlineClearButton}
      </div>

      <PopoverContent align="start" initialFocus={popoverInitialFocus} className="w-auto p-3">
        {children}
        {footer}
      </PopoverContent>
    </Popover>
  );
}
