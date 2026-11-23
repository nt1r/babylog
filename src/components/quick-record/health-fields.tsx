import { NumberStepperCard, QuickChip, SegmentedControl } from '@/components/quick-record/record-controls';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { getTemperatureSeverity, type HealthSubtype, type MedicinePreset } from '@/lib/records';

const HEALTH_SUBTYPE_OPTIONS = [
  { value: 'temperature', label: '体温' },
  { value: 'medicine', label: '用药' },
  { value: 'growth', label: '生长' },
  { value: 'teeth', label: '长牙' },
] as const;

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
        <SegmentedControl
          ariaLabel="健康项目"
          options={HEALTH_SUBTYPE_OPTIONS}
          value={state.subtype}
          onChange={(subtype) => onChange({ subtype })}
        />
      </div>

      {state.subtype === 'temperature' ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-foreground">体温</p>
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
          <NumberStepperCard
            valueText={state.temperatureText}
            unit="℃"
            placeholder="36.6"
            inputAriaLabel="体温数值"
            decrementLabel="-0.1"
            incrementLabel="+0.1"
            decrementAriaLabel="减少 0.1 度"
            incrementAriaLabel="增加 0.1 度"
            inputMode="decimal"
            min={34.0}
            max={43.0}
            step={0.1}
            onChange={(temperatureText) => onChange({ temperatureText })}
            onDecrement={() => stepTemp(-0.1)}
            onIncrement={() => stepTemp(0.1)}
          />
          <div className="flex flex-wrap gap-1.5">
            {TEMP_PRESETS.map((t) => (
              <QuickChip
                key={t}
                tone="health"
                active={hasValidTemp && parsedTemp === t}
                onClick={() => onChange({ temperatureText: t.toFixed(1) })}
              >
                {t.toFixed(1)} ℃
              </QuickChip>
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
                <QuickChip
                  key={med.name}
                  tone="health"
                  active={state.medicineName === med.name}
                  onClick={() =>
                    onChange({
                      medicineName: med.name,
                      ...(med.dosage ? { medicineDosage: med.dosage } : {}),
                    })
                  }
                >
                  {med.name}
                  {med.dosage ? ` · ${med.dosage}` : ''}
                </QuickChip>
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
              <QuickChip
                key={preset}
                tone="health"
                active={state.toothNote === preset}
                onClick={() => onChange({ toothNote: preset })}
              >
                {preset}
              </QuickChip>
            ))}
          </div>
        </Field>
      ) : null}
    </FieldGroup>
  );
}
