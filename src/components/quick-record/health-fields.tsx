import { MinusIcon, PlusIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { getTemperatureSeverity, type HealthSubtype, type MedicinePreset } from '@/lib/records';
import { cn } from '@/lib/utils';

const TEMP_PRESETS = [36.5, 36.8, 37.3, 38.0, 38.5] as const;
const TEETH_PRESETS = ['下中切牙（第 1 颗）', '下中切牙（第 2 颗）', '上中切牙', '侧切牙'] as const;

export interface HealthFormState {
  subtype: HealthSubtype;
  temperatureText: string;
  medicineName: string;
  medicineDosage: string;
  weightKg: string;
  heightCm: string;
  headCm: string;
  toothNote: string;
}

interface HealthFieldsProps {
  readonly state: HealthFormState;
  readonly medicinePresets: readonly MedicinePreset[];
  readonly onChange: (patch: Partial<HealthFormState>) => void;
}

export function HealthFields({ state, medicinePresets, onChange }: HealthFieldsProps) {
  const parsedTemp = Number.parseFloat(state.temperatureText);
  const hasValidTemp = !Number.isNaN(parsedTemp) && parsedTemp >= 34 && parsedTemp <= 43;
  const tempSeverity = hasValidTemp ? getTemperatureSeverity(parsedTemp) : null;

  function stepTemp(delta: number) {
    const base = hasValidTemp ? parsedTemp : 36.6;
    const next = Math.max(34.0, Math.min(43.0, Math.round((base + delta) * 10) / 10));
    onChange({ temperatureText: next.toFixed(1) });
  }

  return (
    <FieldGroup className="gap-4">
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">健康项目</p>
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              { value: 'temperature', label: '体温' },
              { value: 'medicine', label: '用药' },
              { value: 'growth', label: '生长' },
              { value: 'teeth', label: '长牙' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange({ subtype: item.value })}
              className={cn(
                'cursor-pointer rounded-xl border py-2 text-xs font-medium transition-colors',
                state.subtype === item.value
                  ? 'border-health bg-health-soft text-health-soft-foreground'
                  : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {state.subtype === 'temperature' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-foreground">体温（℃）</p>
            {tempSeverity ? (
              <Badge
                variant={
                  tempSeverity.level === 'destructive'
                    ? 'destructive'
                    : tempSeverity.level === 'warning'
                      ? 'warning'
                      : 'success'
                }
              >
                {tempSeverity.label}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="减少 0.1 度" onClick={() => stepTemp(-0.1)}>
              <MinusIcon className="size-4" />
            </Button>
            <Input
              type="number"
              step="0.1"
              min="34.0"
              max="43.0"
              inputMode="decimal"
              value={state.temperatureText}
              placeholder="36.6"
              aria-label="体温数值"
              className="text-center text-lg font-semibold tabular-nums"
              onChange={(event) => onChange({ temperatureText: event.target.value })}
            />
            <Button type="button" variant="outline" size="icon" aria-label="增加 0.1 度" onClick={() => stepTemp(0.1)}>
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEMP_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ temperatureText: t.toFixed(1) })}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs tabular-nums transition-colors',
                  hasValidTemp && parsedTemp === t
                    ? 'border-health bg-health-soft text-health-soft-foreground'
                    : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                )}
              >
                {t.toFixed(1)} ℃
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.subtype === 'medicine' ? (
        <div className="space-y-3">
          <Field>
            <FieldLabel htmlFor="medicine-name-input">药品 / 营养剂名称</FieldLabel>
            <Input
              id="medicine-name-input"
              value={state.medicineName}
              placeholder="例如：维生素 D3、布洛芬混悬液"
              onChange={(event) => onChange({ medicineName: event.target.value })}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {medicinePresets.map((med) => (
                <button
                  key={med.name}
                  type="button"
                  onClick={() =>
                    onChange({
                      medicineName: med.name,
                      ...(med.dosage ? { medicineDosage: med.dosage } : {}),
                    })
                  }
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                    state.medicineName === med.name
                      ? 'border-health bg-health-soft text-health-soft-foreground'
                      : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                  )}
                >
                  {med.name}
                  {med.dosage ? ` · ${med.dosage}` : ''}
                </button>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="medicine-dosage-input">剂量（可选）</FieldLabel>
            <Input
              id="medicine-dosage-input"
              value={state.medicineDosage}
              placeholder="例如：1 粒、2.5 ml"
              onChange={(event) => onChange({ medicineDosage: event.target.value })}
            />
          </Field>
        </div>
      ) : null}

      {state.subtype === 'growth' ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">体重、身高、头围至少填写一项即可保存。</p>
          <div className="grid grid-cols-3 gap-2.5">
            <Field>
              <FieldLabel htmlFor="growth-weight">体重 (kg)</FieldLabel>
              <Input
                id="growth-weight"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="6.8"
                className="tabular-nums"
                value={state.weightKg}
                onChange={(event) => onChange({ weightKg: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="growth-height">身高 (cm)</FieldLabel>
              <Input
                id="growth-height"
                type="number"
                step="0.1"
                inputMode="decimal"
                placeholder="64.5"
                className="tabular-nums"
                value={state.heightCm}
                onChange={(event) => onChange({ heightCm: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="growth-head">头围 (cm)</FieldLabel>
              <Input
                id="growth-head"
                type="number"
                step="0.1"
                inputMode="decimal"
                placeholder="41.0"
                className="tabular-nums"
                value={state.headCm}
                onChange={(event) => onChange({ headCm: event.target.value })}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {state.subtype === 'teeth' ? (
        <Field>
          <FieldLabel htmlFor="teeth-note-input">萌出牙位 / 说明</FieldLabel>
          <Input
            id="teeth-note-input"
            value={state.toothNote}
            placeholder="例如：下中切牙（第 1 颗）"
            onChange={(event) => onChange({ toothNote: event.target.value })}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {TEETH_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChange({ toothNote: preset })}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                  state.toothNote === preset
                    ? 'border-health bg-health-soft text-health-soft-foreground'
                    : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
                )}
              >
                {preset}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
    </FieldGroup>
  );
}
