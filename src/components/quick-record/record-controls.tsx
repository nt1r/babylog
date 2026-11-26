import { useId } from 'react';

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
 * 一体化数值步进卡片：将大号居中数值、单位、左右等高微调按钮及限幅步进逻辑整合在同一模块内，
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
          onWheel={(event) => {
            // 聚焦状态下滚轮滚动页面前主动失焦，防止浏览器原生 number 输入框误增减数值。
            if (document.activeElement === event.currentTarget) {
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => onChange(event.target.value)}
          className="w-18 min-w-0 bg-transparent text-center text-2xl leading-none font-semibold tracking-tight text-foreground tabular-nums outline-none placeholder:text-muted-foreground/50"
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
