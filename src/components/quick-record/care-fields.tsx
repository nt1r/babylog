import { ChoiceCardButton, QuickChip, SegmentedControl } from '@/components/quick-record/record-controls';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  type CareSubtype,
  DIAPER_KIND_LABELS,
  type DiaperKind,
  STOOL_COLOR_LABELS,
  STOOL_CONSISTENCY_LABELS,
  type StoolColor,
  type StoolConsistency,
} from '@/lib/records';

const CARE_SUBTYPE_OPTIONS = [
  { value: 'diaper', label: '排便与尿布' },
  { value: 'bath', label: '洗澡' },
  { value: 'other', label: '其他护理' },
] as const;

export interface CareFormState {
  subtype: CareSubtype;
  diaperKind: DiaperKind;
  stoolConsistency: StoolConsistency | '';
  stoolColor: StoolColor | '';
  careTitle: string;
}

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
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">便便性状（可选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['watery', 'soft', 'formed', 'hard'] as const).map((c) => (
                    <QuickChip
                      key={c}
                      tone="care"
                      active={state.stoolConsistency === c}
                      onClick={() => onChange({ stoolConsistency: state.stoolConsistency === c ? '' : c })}
                    >
                      {STOOL_CONSISTENCY_LABELS[c]}
                    </QuickChip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">便便颜色（可选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['yellow', 'green', 'brown', 'abnormal'] as const).map((color) => (
                    <QuickChip
                      key={color}
                      tone={color === 'abnormal' ? 'destructive' : 'care'}
                      active={state.stoolColor === color}
                      onClick={() => onChange({ stoolColor: state.stoolColor === color ? '' : color })}
                    >
                      {STOOL_COLOR_LABELS[color]}
                    </QuickChip>
                  ))}
                </div>
              </div>
            </div>
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
