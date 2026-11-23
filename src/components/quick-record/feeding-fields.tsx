import { MinusIcon, PlusIcon } from 'lucide-react';
import { MilkAmountControl } from '@/components/quick-record/milk-amount-control';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  ACCEPTANCE_LABELS,
  BREAST_SIDE_LABELS,
  type BreastSide,
  type FeedingMode,
  type FeedingSubtype,
  type SolidAcceptance,
} from '@/lib/records';
import { cn } from '@/lib/utils';

const BREAST_DURATION_PRESETS = [10, 15, 20, 30] as const;
const SOLID_AMOUNT_PRESETS = ['几口', '半碗', '一碗'] as const;

export interface FeedingFormState {
  subtype: FeedingSubtype;
  feedingMode: FeedingMode;
  breastSide: BreastSide;
  amountMLText: string;
  breastMinText: string;
  solidFood: string;
  solidAmount: string;
  acceptance: SolidAcceptance | '';
}

interface FeedingFieldsProps {
  readonly state: FeedingFormState;
  readonly frequentMilk: readonly number[];
  readonly solidPresets: readonly string[];
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
  const parsedMin = Number.parseInt(state.breastMinText, 10);
  const currentMin = Number.isNaN(parsedMin) ? 0 : parsedMin;

  function stepBreastMin(delta: number) {
    const base = currentMin > 0 ? currentMin : 15;
    onChange({ breastMinText: String(Math.max(1, Math.min(180, base + delta))) });
  }

  return (
    <FieldGroup className="gap-4">
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">喂养类型</p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'formula', label: '配方奶' },
              { value: 'breast', label: '母乳' },
              { value: 'solid', label: '辅食' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange({ subtype: item.value })}
              className={cn(
                'cursor-pointer rounded-xl border py-2 text-sm font-medium transition-colors',
                state.subtype === item.value
                  ? 'border-feeding bg-feeding-soft text-feeding-soft-foreground'
                  : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {state.subtype === 'breast' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'direct', label: '亲喂（时长）' },
                { value: 'bottle', label: '瓶喂母乳（ml）' },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onChange({ feedingMode: item.value })}
                className={cn(
                  'cursor-pointer rounded-xl border py-2 text-xs font-medium transition-colors',
                  state.feedingMode === item.value
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {state.feedingMode === 'direct' ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-foreground">亲喂侧别</p>
                  {lastBreastSide ? (
                    <span className="text-xs text-primary">
                      上次：{BREAST_SIDE_LABELS[lastBreastSide]} · 建议{BREAST_SIDE_LABELS[suggestedBreastSide]}
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['left', 'right', 'both'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => onChange({ breastSide: side })}
                      className={cn(
                        'cursor-pointer rounded-xl border py-2.5 text-sm font-medium transition-colors',
                        state.breastSide === side
                          ? 'border-feeding bg-feeding-soft text-feeding-soft-foreground'
                          : 'border-border/80 bg-background text-foreground hover:bg-muted/50',
                      )}
                    >
                      {BREAST_SIDE_LABELS[side]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[13px] font-medium text-foreground">亲喂时长（分钟）</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="减少 5 分钟"
                    onClick={() => stepBreastMin(-5)}
                  >
                    <MinusIcon className="size-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={180}
                    inputMode="numeric"
                    value={state.breastMinText}
                    placeholder="如 15"
                    aria-label="亲喂时长分钟数"
                    className="text-center text-base font-semibold tabular-nums"
                    onChange={(event) => onChange({ breastMinText: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="增加 5 分钟"
                    onClick={() => stepBreastMin(5)}
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BREAST_DURATION_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onChange({ breastMinText: String(m) })}
                      className={cn(
                        'cursor-pointer rounded-full border px-3 py-1 text-xs tabular-nums transition-colors',
                        currentMin === m
                          ? 'border-feeding bg-feeding-soft text-feeding-soft-foreground'
                          : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {m} 分钟
                    </button>
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
              onChange={(event) => onChange({ solidFood: event.target.value })}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {solidPresets.map((food) => (
                <button
                  key={food}
                  type="button"
                  onClick={() => onChange({ solidFood: food })}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                    state.solidFood === food
                      ? 'border-feeding bg-feeding-soft text-feeding-soft-foreground'
                      : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                  )}
                >
                  {food}
                </button>
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
                <button
                  key={amt}
                  type="button"
                  onClick={() => onChange({ solidAmount: amt })}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                    state.solidAmount === amt
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                  )}
                >
                  {amt}
                </button>
              ))}
            </div>
          </Field>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">宝宝接受度（可选）</p>
            <div className="grid grid-cols-3 gap-2">
              {(['like', 'neutral', 'dislike'] as const).map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => onChange({ acceptance: state.acceptance === acc ? '' : acc })}
                  className={cn(
                    'cursor-pointer rounded-xl border py-2 text-xs font-medium transition-colors',
                    state.acceptance === acc
                      ? 'border-feeding bg-feeding-soft text-feeding-soft-foreground'
                      : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {ACCEPTANCE_LABELS[acc]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </FieldGroup>
  );
}
