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
import { cn } from '@/lib/utils';

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
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'diaper', label: '排便与尿布' },
              { value: 'bath', label: '洗澡' },
              { value: 'other', label: '其他护理' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange({ subtype: item.value })}
              className={cn(
                'cursor-pointer rounded-xl border py-2 text-xs font-medium transition-colors',
                state.subtype === item.value
                  ? 'border-care bg-care-soft text-care-soft-foreground'
                  : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {state.subtype === 'diaper' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(['pee', 'poop', 'both'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onChange({ diaperKind: kind })}
                className={cn(
                  'cursor-pointer rounded-xl border py-2.5 text-sm font-medium transition-colors',
                  state.diaperKind === kind
                    ? 'border-care bg-care-soft text-care-soft-foreground'
                    : 'border-border/80 bg-background text-foreground hover:bg-muted/50',
                )}
              >
                {DIAPER_KIND_LABELS[kind]}
              </button>
            ))}
          </div>

          {state.diaperKind === 'poop' || state.diaperKind === 'both' ? (
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">便便性状（可选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['watery', 'soft', 'formed', 'hard'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => onChange({ stoolConsistency: state.stoolConsistency === c ? '' : c })}
                      className={cn(
                        'cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors',
                        state.stoolConsistency === c
                          ? 'border-care bg-care-soft text-care-soft-foreground'
                          : 'border-border/80 bg-background text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {STOOL_CONSISTENCY_LABELS[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">便便颜色（可选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['yellow', 'green', 'brown', 'abnormal'] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => onChange({ stoolColor: state.stoolColor === color ? '' : color })}
                      className={cn(
                        'cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors',
                        state.stoolColor === color
                          ? color === 'abnormal'
                            ? 'border-destructive bg-destructive-soft text-destructive-soft-foreground'
                            : 'border-care bg-care-soft text-care-soft-foreground'
                          : 'border-border/80 bg-background text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {STOOL_COLOR_LABELS[color]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.subtype === 'bath' ? (
        <p className="rounded-xl border border-border/70 bg-muted/25 px-3.5 py-2.5 text-xs text-muted-foreground">
          点击「保存记录」即可打卡一次洗澡，可在下方备注水温、洗发或抚触情况。
        </p>
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
              <button
                key={title}
                type="button"
                onClick={() => onChange({ careTitle: title })}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                  state.careTitle === title
                    ? 'border-care bg-care-soft text-care-soft-foreground'
                    : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                )}
              >
                {title}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
    </FieldGroup>
  );
}
