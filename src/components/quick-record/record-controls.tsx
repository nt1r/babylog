import type { ReactNode } from 'react';
import { useId } from 'react';
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
 * L2 分段滑槽控件：用于二级子类型切换（如配方奶/母乳/辅食），
 * 以浅底槽 + 浮起白卡与顶部 L1 彩色分类栏明确区分层级。
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
  readonly tone: ControlTone;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * L3 表单内单选块：统一 40px 高度（与标准输入框等高）和 14px 字号，
 * 消除各级选项高度与字号倒挂的问题。
 */
export function ChoiceCardButton({ active, tone, onClick, children, className }: ChoiceCardButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-10 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
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
  readonly tone?: ControlTone;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * L5 快捷预设胶囊：默认去描边柔底减少视觉噪音，选中态以分类软色高亮。
 * 仅在传入 active 布尔值时输出 aria-pressed，避免一次性动作按钮被读屏误报为切换开关。
 */
export function QuickChip({ active, tone = 'primary', onClick, children, className }: QuickChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 cursor-pointer items-center justify-center rounded-full border px-3 text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? CHIP_ACTIVE_TONE_CLASSES[tone]
          : 'border-transparent bg-muted/55 text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

const STEPPER_BUTTON_CLASS =
  'flex h-10 min-w-13 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border/75 bg-card px-2.5 text-sm font-medium text-foreground tabular-nums shadow-2xs transition-all outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95';

interface NumberStepperCardProps {
  readonly valueText: string;
  readonly unit: string;
  readonly unitAriaLabel?: string;
  readonly placeholder: string;
  readonly inputAriaLabel: string;
  readonly min: number;
  /** 可选步进按钮下限（如奶量允许手输 1 ml，但 -10 步进保持停在 10 ml 整十档位）。 */
  readonly stepMin?: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly precision?: number;
  readonly onChange: (nextText: string) => void;
}

/**
 * L4 一体化数值步进卡片：将大号居中数值、单位、左右等高微调按钮及限幅步进逻辑整合在同一模块内，
 * 输入框保持字符串受控以确保退格删空重输流畅，仅在点击步进按钮时解析、限幅并格式化。
 */
export function NumberStepperCard({
  valueText,
  unit,
  unitAriaLabel,
  placeholder,
  inputAriaLabel,
  min,
  stepMin,
  max,
  step,
  defaultValue,
  precision = 0,
  onChange,
}: NumberStepperCardProps) {
  const inputId = useId();
  const isDecimal = precision > 0;
  const spokenUnit = unitAriaLabel ?? unit;
  const effectiveMin = stepMin ?? min;

  function applyStep(direction: -1 | 1) {
    const trimmed = valueText.trim();
    const parsed = trimmed ? Number(trimmed) : Number.NaN;
    // 有限数值先收敛到合法边界 [min, max]，避免越界输入跳回默认值；
    // 仅当从 >= effectiveMin 向下步进时停在 stepMin，避免手输 < stepMin（如 5 ml）时点减号反而变大。
    const base = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : defaultValue;
    const factor = 10 ** precision;
    const rounded = Math.round((base + direction * step) * factor) / factor;
    const lowerBound = direction === -1 && base >= effectiveMin ? effectiveMin : min;
    const clamped = Math.max(lowerBound, Math.min(max, rounded));
    onChange(isDecimal ? clamped.toFixed(precision) : String(Math.round(clamped)));
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-border/80 bg-background/70 p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 dark:bg-input/20">
      <button
        type="button"
        aria-label={`减少 ${step} ${spokenUnit}`}
        onClick={() => applyStep(-1)}
        className={STEPPER_BUTTON_CLASS}
      >
        -{step}
      </button>

      <label htmlFor={inputId} className="flex min-w-0 flex-1 cursor-text items-baseline justify-center gap-1 px-1">
        <input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step={isDecimal ? step : undefined}
          inputMode={isDecimal ? 'decimal' : 'numeric'}
          value={valueText}
          placeholder={placeholder}
          aria-label={inputAriaLabel}
          onChange={(event) => onChange(event.target.value)}
          className="w-18 min-w-0 bg-transparent text-center text-2xl leading-none font-semibold tracking-tight text-foreground tabular-nums outline-none placeholder:text-muted-foreground/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="shrink-0 text-sm font-medium text-muted-foreground select-none">{unit}</span>
      </label>

      <button
        type="button"
        aria-label={`增加 ${step} ${spokenUnit}`}
        onClick={() => applyStep(1)}
        className={STEPPER_BUTTON_CLASS}
      >
        +{step}
      </button>
    </div>
  );
}
