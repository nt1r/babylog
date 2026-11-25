import { FEEDING_BOUNDS, type FeedingFormState } from '@/components/quick-record/codecs/feeding';
import { MilkAmountControl } from '@/components/quick-record/milk-amount-control';
import { NumberStepperCard } from '@/components/quick-record/record-controls';
import { ChoiceCardButton, QuickChip, SegmentedControl } from '@/components/ui/choice-controls';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FEEDING_SUBTYPE_OPTIONS } from '@/lib/categories';
import { parseStrictInt } from '@/lib/number';
import { ACCEPTANCE_LABELS, BREAST_SIDE_LABELS, type BreastSide, type SolidFoodPreset } from '@/lib/records';

const BREAST_MODE_OPTIONS = [
  { value: 'direct', label: '亲喂' },
  { value: 'bottle', label: '瓶喂母乳' },
] as const;

const BREAST_DURATION_PRESETS = [10, 15, 20, 30] as const;
const SOLID_AMOUNT_PRESETS = ['几口', '半碗', '一碗'] as const;

interface FeedingFieldsProps {
  readonly state: FeedingFormState;
  readonly frequentMilk: readonly number[];
  readonly solidPresets: readonly SolidFoodPreset[];
  readonly lastBreastSide: BreastSide | null;
  readonly suggestedBreastSide: BreastSide;
  readonly onChange: (patch: Partial<FeedingFormState>) => void;
}

export function FeedingFields({
  state,
  frequentMilk,
  solidPresets,
  lastBreastSide,
  suggestedBreastSide,
  onChange,
}: FeedingFieldsProps) {
  const currentMin = parseStrictInt(state.breastMinText) ?? 0;

  return (
    <FieldGroup className="gap-4">
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">喂养类型</p>
        <SegmentedControl
          ariaLabel="喂养类型"
          options={FEEDING_SUBTYPE_OPTIONS}
          value={state.subtype}
          onChange={(subtype) => onChange({ subtype })}
        />
      </div>

      {state.subtype === 'breast' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">喂养方式</p>
            <div className="grid grid-cols-2 gap-2">
              {BREAST_MODE_OPTIONS.map((item) => (
                <ChoiceCardButton
                  key={item.value}
                  tone="feeding"
                  active={state.feedingMode === item.value}
                  onClick={() => onChange({ feedingMode: item.value })}
                >
                  {item.label}
                </ChoiceCardButton>
              ))}
            </div>
          </div>

          {state.feedingMode === 'direct' ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-foreground">亲喂侧别</p>
                  {lastBreastSide ? (
                    <span className="text-xs text-primary">
                      上次：{BREAST_SIDE_LABELS[lastBreastSide]} · 建议{BREAST_SIDE_LABELS[suggestedBreastSide]}
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['left', 'right', 'both'] as const).map((side) => (
                    <ChoiceCardButton
                      key={side}
                      tone="feeding"
                      active={state.breastSide === side}
                      onClick={() => onChange({ breastSide: side })}
                    >
                      {BREAST_SIDE_LABELS[side]}
                    </ChoiceCardButton>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <p className="text-[13px] font-medium text-foreground">亲喂时长</p>
                <NumberStepperCard
                  valueText={state.breastMinText}
                  unit="分钟"
                  placeholder="15"
                  inputAriaLabel="亲喂时长分钟数"
                  min={FEEDING_BOUNDS.breastMin}
                  max={FEEDING_BOUNDS.breastMax}
                  step={FEEDING_BOUNDS.breastStep}
                  defaultValue={FEEDING_BOUNDS.breastDefault}
                  onChange={(breastMinText) => onChange({ breastMinText })}
                />
                <div className="flex flex-wrap gap-1.5">
                  {BREAST_DURATION_PRESETS.map((m) => (
                    <QuickChip
                      key={m}
                      tone="feeding"
                      active={currentMin === m}
                      onClick={() => onChange({ breastMinText: String(m) })}
                    >
                      {m} 分钟
                    </QuickChip>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <MilkAmountControl
              valueText={state.amountMLText}
              onChange={(nextText) => onChange({ amountMLText: nextText })}
              presets={frequentMilk}
            />
          )}
        </div>
      ) : null}

      {state.subtype === 'formula' ? (
        <MilkAmountControl
          valueText={state.amountMLText}
          onChange={(nextText) => onChange({ amountMLText: nextText })}
          presets={frequentMilk}
        />
      ) : null}

      {state.subtype === 'solid' ? (
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="solid-food-input">辅食内容</FieldLabel>
            <Input
              id="solid-food-input"
              value={state.solidFood}
              placeholder="例如：高铁米粉、南瓜泥"
              onChange={(event) => {
                const nextFood = event.target.value;
                // 手动输入仅在份量留空且精确命中历史辅食时自动补全，避免覆盖家长刚手填的份量。
                const matched = !state.solidAmount.trim()
                  ? solidPresets.find((item) => item.food === nextFood.trim() && item.amount)
                  : undefined;
                onChange({
                  solidFood: nextFood,
                  ...(matched ? { solidAmount: matched.amount } : {}),
                });
              }}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {solidPresets.map((item) => (
                <QuickChip
                  key={item.food}
                  tone="feeding"
                  active={state.solidFood === item.food}
                  onClick={() =>
                    // 主/副联动胶囊切换时同步覆写或清空份量，防止残留上一个辅食的旧份量。
                    onChange({
                      solidFood: item.food,
                      solidAmount: item.amount,
                    })
                  }
                >
                  {item.food}
                  {item.amount ? ` · ${item.amount}` : ''}
                </QuickChip>
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="solid-amount-input">份量（可选）</FieldLabel>
            <Input
              id="solid-amount-input"
              value={state.solidAmount}
              placeholder="例如：半碗、30 g"
              onChange={(event) => onChange({ solidAmount: event.target.value })}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SOLID_AMOUNT_PRESETS.map((amt) => (
                <QuickChip
                  key={amt}
                  tone="feeding"
                  active={state.solidAmount === amt}
                  onClick={() => onChange({ solidAmount: amt })}
                >
                  {amt}
                </QuickChip>
              ))}
            </div>
          </Field>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">宝宝接受度（可选）</p>
            <div className="grid grid-cols-3 gap-2">
              {(['like', 'neutral', 'dislike'] as const).map((acc) => (
                <ChoiceCardButton
                  key={acc}
                  tone="feeding"
                  active={state.acceptance === acc}
                  onClick={() => onChange({ acceptance: state.acceptance === acc ? '' : acc })}
                >
                  {ACCEPTANCE_LABELS[acc]}
                </ChoiceCardButton>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </FieldGroup>
  );
}
