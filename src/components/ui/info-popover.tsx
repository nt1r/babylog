import { CircleHelp, Info, ShieldAlert, XIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export type InfoPopoverTone = 'default' | 'warning' | 'health' | 'info';
export type InfoPopoverTriggerVariant = 'icon' | 'pill';

export interface InfoPopoverProps {
  /** 浮层与移动端抽屉顶部标题。 */
  readonly title: string;
  /** 可选副标题，紧跟标题下方展示。 */
  readonly description?: string;
  /** 胶囊按钮文案（triggerVariant="pill" 时展示，亦作为读屏回退标签）。 */
  readonly label?: string;
  /** 触发器形态：icon 为紧凑图标按钮，pill 为带图标与简短文字的胶囊提示按钮。 */
  readonly triggerVariant?: InfoPopoverTriggerVariant;
  /** 语义色调，同时作用于触发器与浮层标题图标。 */
  readonly tone?: InfoPopoverTone;
  /** 自定义触发器与标题图标；未传时按 tone 选用默认图标。 */
  readonly icon?: ReactNode;
  /** 中文无障碍标签。 */
  readonly ariaLabel?: string;
  /** 桌面端 Popover 弹出方位。 */
  readonly side?: ComponentProps<typeof PopoverContent>['side'];
  /** 桌面端 Popover 对齐方式。 */
  readonly align?: ComponentProps<typeof PopoverContent>['align'];
  /** 禁用态：拦截打开、始终放行关闭并在转为 disabled 时自动收起。 */
  readonly disabled?: boolean;
  /** 桌面端 Popover 内容容器自定义类名。 */
  readonly contentClassName?: string;
  /** 触发器按钮自定义类名。 */
  readonly triggerClassName?: string;
  /** 展开后的提示正文内容。 */
  readonly children: ReactNode;
}

const TONE_ICON_BADGE: Record<InfoPopoverTone, string> = {
  default: 'bg-primary/12 text-primary',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  health: 'bg-health-soft text-health-soft-foreground',
  info: 'bg-info-soft text-info-soft-foreground',
};

const TONE_ICON_TRIGGER: Record<InfoPopoverTone, string> = {
  default: 'text-muted-foreground hover:bg-accent hover:text-foreground',
  warning: 'text-warning-soft-foreground hover:bg-warning-soft/80',
  health: 'text-health-soft-foreground hover:bg-health-soft/80',
  info: 'text-info-soft-foreground hover:bg-info-soft/80',
};

const TONE_PILL_TRIGGER: Record<InfoPopoverTone, string> = {
  default:
    'border-border/80 bg-muted/40 text-muted-foreground hover:border-primary/45 hover:bg-accent/60 hover:text-foreground',
  warning:
    'border-warning/35 bg-warning-soft/55 text-warning-soft-foreground hover:border-warning/60 hover:bg-warning-soft/85',
  health:
    'border-health/35 bg-health-soft/50 text-health-soft-foreground hover:border-health/60 hover:bg-health-soft/80',
  info: 'border-info/35 bg-info-soft/50 text-info-soft-foreground hover:border-info/60 hover:bg-info-soft/80',
};

function renderDefaultIcon(tone: InfoPopoverTone, className: string) {
  if (tone === 'warning') {
    return <ShieldAlert className={className} aria-hidden="true" strokeWidth={1.8} />;
  }
  if (tone === 'info' || tone === 'health') {
    return <Info className={className} aria-hidden="true" strokeWidth={1.8} />;
  }
  return <CircleHelp className={className} aria-hidden="true" strokeWidth={1.8} />;
}

/**
 * 可复用的点击式帮助提示浮层原语：
 * 桌面端使用锚定 Popover 展开，移动端自动切换为底部嵌套 Drawer（支持在 EntityDrawer 内平滑堆叠），
 * 用于将长段注意事项、选型规则或说明文案收敛为按需查看的小巧提示入口。
 */
export function InfoPopover({
  title,
  description,
  label,
  triggerVariant = 'icon',
  tone = 'default',
  icon,
  ariaLabel,
  side = 'bottom',
  align = 'start',
  disabled = false,
  contentClassName,
  triggerClassName,
  children,
}: InfoPopoverProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // 浮层已打开时若外部切换为 disabled，自动收起避免停留在不可操作态。
  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && disabled) return;
    setOpen(nextOpen);
  }

  const resolvedAriaLabel = ariaLabel ?? (label ? `查看${label}` : `查看${title}`);
  const triggerIcon = icon ?? renderDefaultIcon(tone, 'size-3.5 shrink-0');
  const headerIcon = icon ?? renderDefaultIcon(tone, 'size-4 shrink-0');

  const triggerButton =
    triggerVariant === 'pill' ? (
      <button
        type="button"
        disabled={disabled}
        aria-label={resolvedAriaLabel}
        className={cn(
          'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          TONE_PILL_TRIGGER[tone],
          triggerClassName,
        )}
      >
        {triggerIcon}
        <span>{label ?? title}</span>
      </button>
    ) : (
      <button
        type="button"
        disabled={disabled}
        aria-label={resolvedAriaLabel}
        className={cn(
          'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          TONE_ICON_TRIGGER[tone],
          triggerClassName,
        )}
      >
        {triggerIcon}
      </button>
    );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="down" showSwipeHandle>
        <DrawerTrigger render={triggerButton} />

        <DrawerContent className="max-h-[80dvh]">
          <DrawerHeader className="relative pr-12">
            <div className="flex items-center gap-2">
              <span
                className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', TONE_ICON_BADGE[tone])}
              >
                {headerIcon}
              </span>
              <DrawerTitle className="text-[15px]">{title}</DrawerTitle>
            </div>
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
            <DrawerClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3.5 right-3.5"
                  aria-label="关闭提示"
                />
              }
            >
              <XIcon className="size-4" />
            </DrawerClose>
          </DrawerHeader>

          {/* 标注 data-base-ui-swipe-ignore，避免移动端阅读长说明滚动时误触底部抽屉下滑关闭 */}
          <div
            data-base-ui-swipe-ignore
            className="flex-1 overflow-y-auto px-5 pt-3.5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-[13px] leading-relaxed text-muted-foreground"
          >
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={triggerButton} />

      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        className={cn('w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0', contentClassName)}
      >
        <PopoverHeader className="flex-row items-start justify-between gap-2 border-b border-border/70 bg-muted/25 px-3.5 py-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg',
                TONE_ICON_BADGE[tone],
              )}
            >
              {headerIcon}
            </span>
            <div className="min-w-0 space-y-0.5">
              <PopoverTitle className="text-[13px] leading-snug font-semibold text-foreground">{title}</PopoverTitle>
              {description ? (
                <PopoverDescription className="text-xs leading-snug">{description}</PopoverDescription>
              ) : null}
            </div>
          </div>
          <PopoverClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="关闭提示"
              />
            }
          >
            <XIcon className="size-3.5" />
          </PopoverClose>
        </PopoverHeader>

        <div className="max-h-80 overflow-y-auto px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
