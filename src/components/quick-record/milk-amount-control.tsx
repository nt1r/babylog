import { NumberStepperCard } from '@/components/quick-record/record-controls';
import { QuickChip } from '@/components/ui/choice-controls';
import { parseStrictInt } from '@/lib/number';
import { FEEDING_BOUNDS } from '@/lib/record-codecs';

interface MilkAmountControlProps {
  readonly valueText: string;
  readonly onChange: (nextText: string) => void;
  readonly presets: readonly number[];
}

/** 极简奶量步进卡片（左右 -10/+10 + 大号可编辑数字）与常用档位轻胶囊。 */
export function MilkAmountControl({ valueText, onChange, presets }: MilkAmountControlProps) {
  const currentNum = parseStrictInt(valueText) ?? 0;

  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-medium text-foreground">奶量</p>
      <NumberStepperCard
        valueText={valueText}
        unit="ml"
        unitAriaLabel="毫升"
        placeholder={String(FEEDING_BOUNDS.milkDefault)}
        inputAriaLabel="奶量毫升数"
        min={FEEDING_BOUNDS.milkMin}
        stepMin={FEEDING_BOUNDS.milkStepMin}
        max={FEEDING_BOUNDS.milkMax}
        step={FEEDING_BOUNDS.milkStep}
        defaultValue={FEEDING_BOUNDS.milkDefault}
        onChange={onChange}
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
