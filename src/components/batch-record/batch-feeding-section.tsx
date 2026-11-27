import { useId } from 'react';
import { QuickChip } from '@/components/ui/choice-controls';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { parseStrictInt } from '@/lib/number';
import { BREAST_DURATION_PRESETS } from '@/lib/record-codecs';
import { BREAST_SIDE_LABELS, type BreastSide } from '@/lib/records';
import { cn } from '@/lib/utils';

function ClearButton({ disabled, onClick }: { readonly disabled: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      清空
    </button>
  );
}

interface BatchMilkRowProps {
  readonly label: string;
  readonly valueText: string;
  readonly presets: readonly number[];
  readonly disabled: boolean;
  readonly onChange: (nextText: string) => void;
}

/** 紧凑奶量填即录入卡：左侧使用 InputGroup 承接数值与 ml 单位，右侧紧跟常用奶量胶囊，留空自动跳过。 */
function BatchMilkRow({ label, valueText, presets, disabled, onChange }: BatchMilkRowProps) {
  const inputId = useId();
  const active = valueText.trim() !== '';
  const currentNum = parseStrictInt(valueText);

  return (
    <div
      className={cn(
        'space-y-2.5 rounded-2xl border p-3.5 transition-colors',
        active ? 'border-feeding/60 bg-feeding-soft/25' : 'border-border/75 bg-card/70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {active ? <ClearButton disabled={disabled} onClick={() => onChange('')} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="h-9 w-32 shrink-0 bg-background/85">
          {/* 使用 type="text" + inputMode="numeric" 避免浏览器 number badInput 将非法字符静默置空为“跳过” */}
          <InputGroupInput
            id={inputId}
            type="text"
            inputMode="numeric"
            value={valueText}
            disabled={disabled}
            placeholder="输入奶量"
            aria-label={`${label}奶量毫升数`}
            onChange={(event) => onChange(event.target.value)}
            className="pr-1 pl-3 tabular-nums"
          />
          <InputGroupAddon align="inline-end" className="pr-2.5 text-xs">
            ml
          </InputGroupAddon>
        </InputGroup>

        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((ml) => {
            const selected = currentNum === ml;
            return (
              <QuickChip
                key={ml}
                tone="feeding"
                active={selected}
                disabled={disabled}
                onClick={() => onChange(selected ? '' : String(ml))}
              >
                {ml} ml
              </QuickChip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface BatchFeedingSectionProps {
  readonly directBreastSide: BreastSide | '';
  readonly directBreastMinText: string;
  readonly bottleBreastMLText: string;
  readonly formulaMLText: string;
  readonly frequentMilk: readonly number[];
  readonly defaultBreastMin: number;
  readonly suggestedBreastSide: BreastSide;
  readonly disabled: boolean;
  readonly onToggleBreastSide: (side: BreastSide) => void;
  readonly onClearDirectBreast: () => void;
  readonly onDirectBreastMinChange: (nextText: string) => void;
  readonly onBottleBreastChange: (nextText: string) => void;
  readonly onFormulaChange: (nextText: string) => void;
}

/** 批量补录喂养区块：亲喂、瓶喂母乳与配方奶三项独立填即录入，未填项自动跳过。 */
export function BatchFeedingSection({
  directBreastSide,
  directBreastMinText,
  bottleBreastMLText,
  formulaMLText,
  frequentMilk,
  defaultBreastMin,
  suggestedBreastSide,
  disabled,
  onToggleBreastSide,
  onClearDirectBreast,
  onDirectBreastMinChange,
  onBottleBreastChange,
  onFormulaChange,
}: BatchFeedingSectionProps) {
  const currentBreastMin = parseStrictInt(directBreastMinText);

  return (
    <section aria-label="喂奶记录" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[13px] font-semibold text-foreground">喂奶记录</span>
        <span className="text-xs text-muted-foreground">没喂可留空</span>
      </div>

      {/* 亲喂：点选侧别即激活并带入默认时长，再次点击或点清空恢复跳过 */}
      <div
        className={cn(
          'space-y-2.5 rounded-2xl border p-3.5 transition-colors',
          directBreastSide ? 'border-feeding/60 bg-feeding-soft/25' : 'border-border/75 bg-card/70',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">亲喂</span>
            {!directBreastSide ? (
              <span className="text-xs text-primary">建议{BREAST_SIDE_LABELS[suggestedBreastSide]}</span>
            ) : (
              <ClearButton disabled={disabled} onClick={onClearDirectBreast} />
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {(['left', 'right', 'both'] as const).map((side) => (
              <QuickChip
                key={side}
                tone="feeding"
                variant="outline"
                active={directBreastSide === side}
                disabled={disabled}
                onClick={() => onToggleBreastSide(side)}
              >
                {BREAST_SIDE_LABELS[side]}
              </QuickChip>
            ))}
          </div>
        </div>

        {directBreastSide ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-feeding/25 pt-2.5">
            <InputGroup className="h-9 w-32 shrink-0 bg-background/85">
              <InputGroupInput
                id="batch-breast-min"
                type="text"
                inputMode="numeric"
                value={directBreastMinText}
                disabled={disabled}
                placeholder={String(defaultBreastMin)}
                aria-label="亲喂时长分钟数"
                onChange={(event) => onDirectBreastMinChange(event.target.value)}
                className="pr-1 pl-3 tabular-nums"
              />
              <InputGroupAddon align="inline-end" className="pr-2.5 text-xs">
                分钟
              </InputGroupAddon>
            </InputGroup>

            <div className="flex flex-wrap items-center gap-1.5">
              {BREAST_DURATION_PRESETS.map((m) => (
                <QuickChip
                  key={m}
                  tone="feeding"
                  disabled={disabled}
                  active={currentBreastMin === m}
                  onClick={() => onDirectBreastMinChange(String(m))}
                >
                  {m} 分钟
                </QuickChip>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <BatchMilkRow
        label="瓶喂母乳"
        valueText={bottleBreastMLText}
        presets={frequentMilk}
        disabled={disabled}
        onChange={onBottleBreastChange}
      />

      <BatchMilkRow
        label="配方奶"
        valueText={formulaMLText}
        presets={frequentMilk}
        disabled={disabled}
        onChange={onFormulaChange}
      />
    </section>
  );
}
