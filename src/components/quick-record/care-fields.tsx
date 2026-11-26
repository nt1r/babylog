import type { CareFormState } from '@/components/quick-record/codecs/care';
import { StoolObservationPanel } from '@/components/quick-record/stool-observation-panel';
import { ChoiceCardButton, QuickChip, SegmentedControl } from '@/components/ui/choice-controls';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CARE_SUBTYPE_OPTIONS } from '@/lib/categories';
import { DIAPER_KIND_LABELS } from '@/lib/records';

interface CareFieldsProps {
  readonly state: CareFormState;
  readonly otherPresets: readonly string[];
  readonly onChange: (patch: Partial<CareFormState>) => void;
}

export function CareFields({ state, otherPresets, onChange }: CareFieldsProps) {
  return (
    <FieldGroup className="gap-4">
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">护理类型</p>
        <SegmentedControl
          ariaLabel="护理类型"
          options={CARE_SUBTYPE_OPTIONS}
          value={state.subtype}
          onChange={(subtype) => onChange({ subtype })}
        />
      </div>

      {state.subtype === 'diaper' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">排便情况</p>
            <div className="grid grid-cols-3 gap-2">
              {(['pee', 'poop', 'both'] as const).map((kind) => (
                <ChoiceCardButton
                  key={kind}
                  tone="care"
                  active={state.diaperKind === kind}
                  onClick={() => onChange({ diaperKind: kind })}
                >
                  {DIAPER_KIND_LABELS[kind]}
                </ChoiceCardButton>
              ))}
            </div>
          </div>

          {state.diaperKind === 'poop' || state.diaperKind === 'both' ? (
            <StoolObservationPanel
              stoolConsistency={state.stoolConsistency}
              stoolColor={state.stoolColor}
              onChange={(patch) => onChange(patch)}
            />
          ) : null}
        </div>
      ) : null}

      {state.subtype === 'other' ? (
        <Field>
          <FieldLabel htmlFor="care-title-input">护理内容</FieldLabel>
          <Input
            id="care-title-input"
            value={state.careTitle}
            placeholder="例如：剪指甲、抚触按摩"
            onChange={(event) => onChange({ careTitle: event.target.value })}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {otherPresets.map((title) => (
              <QuickChip
                key={title}
                tone="care"
                active={state.careTitle === title}
                onClick={() => onChange({ careTitle: title })}
              >
                {title}
              </QuickChip>
            ))}
          </div>
        </Field>
      ) : null}
    </FieldGroup>
  );
}
