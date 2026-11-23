import { NumberStepperCard, QuickChip } from '@/components/quick-record/record-controls';

interface MilkAmountControlProps {
  readonly valueText: string;
  readonly onChange: (nextText: string) => void;
  readonly presets: readonly number[];
}

/** 极简奶量步进卡片（左右 -10/+10 + 大号可编辑数字）与常用档位轻胶囊。 */
export function MilkAmountControl({ valueText, onChange, presets }: MilkAmountControlProps) {
  const parsed = Number.parseInt(valueText, 10);
  const currentNum = Number.isNaN(parsed) ? 0 : parsed;

  function stepBy(delta: number) {
    const base = currentNum > 0 ? currentNum : 90;
    const next = Math.max(10, Math.min(1000, base + delta));
    onChange(String(next));
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-medium text-foreground">奶量</p>
      <NumberStepperCard
        valueText={valueText}
        unit="ml"
        placeholder="120"
        inputAriaLabel="奶量毫升数"
        decrementLabel="-10"
        incrementLabel="+10"
        decrementAriaLabel="减少 10 毫升"
        incrementAriaLabel="增加 10 毫升"
        inputMode="numeric"
        min={1}
        max={1000}
        onChange={onChange}
        onDecrement={() => stepBy(-10)}
        onIncrement={() => stepBy(10)}
      />
      <div className="flex flex-wrap gap-1.5">
        {presets.map((ml) => (
          <QuickChip key={ml} tone="feeding" active={currentNum === ml} onClick={() => onChange(String(ml))}>
            {ml} ml
          </QuickChip>
        ))}
      </div>
    </div>
  );
}
