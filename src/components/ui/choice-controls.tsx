import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ControlTone = 'feeding' | 'sleep' | 'care' | 'health' | 'primary' | 'destructive';

const ACTIVE_TONE_CLASSES: Record<ControlTone, string> = {
  feeding: 'border-feeding bg-feeding-soft text-feeding-soft-foreground',
  sleep: 'border-sleep bg-sleep-soft text-sleep-soft-foreground',
  care: 'border-care bg-care-soft text-care-soft-foreground',
  health: 'border-health bg-health-soft text-health-soft-foreground',
  primary: 'border-primary bg-accent text-accent-foreground',
  destructive: 'border-destructive bg-destructive-soft text-destructive-soft-foreground',
};

const CHIP_ACTIVE_TONE_CLASSES: Record<ControlTone, string> = {
  feeding: 'border-feeding/60 bg-feeding-soft text-feeding-soft-foreground',
  sleep: 'border-sleep/60 bg-sleep-soft text-sleep-soft-foreground',
  care: 'border-care/60 bg-care-soft text-care-soft-foreground',
  health: 'border-health/60 bg-health-soft text-health-soft-foreground',
  primary: 'border-primary/50 bg-accent text-accent-foreground',
  destructive: 'border-destructive/60 bg-destructive-soft text-destructive-soft-foreground',
};

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly columns?: 2 | 3 | 4;
}

/**
 * 分段滑槽控件：用于同级子类型切换（如配方奶/母乳/辅食），
 * 以浅底槽 + 浮起白卡与顶部彩色分类栏明确区分层级。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
}: SegmentedControlProps<T>) {
  const cols = columns ?? (options.length === 2 ? 2 : options.length === 4 ? 4 : 3);
  return (
    <fieldset
      aria-label={ariaLabel}
      className={cn(
        'grid min-w-0 gap-1 rounded-xl border-0 bg-muted/65 p-1',
        cols === 2 && 'grid-cols-2',
        cols === 3 && 'grid-cols-3',
        cols === 4 && 'grid-cols-4',
      )}
    >
      {options.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex h-8 cursor-pointer items-center justify-center rounded-lg px-2 text-[13px] font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              active ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </fieldset>
  );
}

interface ChoiceCardButtonProps {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly tone?: ControlTone;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * 表单单选块：默认 40px 高度（与标准输入框等高）和 14px 字号，
 * 统一全站表单内的二选一 / 三选一交互、焦点环与选中态配色。
 */
export function ChoiceCardButton({
  active,
  disabled,
  tone = 'primary',
  onClick,
  children,
  className,
}: ChoiceCardButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-10 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? ACTIVE_TONE_CLASSES[tone]
          : 'border-border/80 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface QuickChipProps {
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly tone?: ControlTone;
  readonly variant?: 'soft' | 'outline';
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * 通用快捷预设与筛选胶囊：移动端保证 32px 舒适热区（桌面紧凑为 28px），
 * 仅在传入 active 布尔值时输出 aria-pressed，避免一次性动作按钮被读屏误报为切换开关。
 */
export function QuickChip({
  active,
  disabled,
  tone = 'primary',
  variant = 'soft',
  onClick,
  children,
  className,
}: QuickChipProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center justify-center rounded-full border px-3 text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-7',
        active
          ? CHIP_ACTIVE_TONE_CLASSES[tone]
          : variant === 'outline'
            ? 'border-border/80 bg-background text-muted-foreground hover:border-primary/45 hover:bg-muted/50 hover:text-foreground'
            : 'border-transparent bg-muted/55 text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}
