import { HEALTH_BOUNDS, type HealthFormState } from '@/components/quick-record/codecs/health';
import { NumberStepperCard, QuickChip, SegmentedControl } from '@/components/quick-record/record-controls';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { HEALTH_SUBTYPE_OPTIONS } from '@/lib/categories';
import { parseOptionalStrictNumber } from '@/lib/number';
import { getTemperatureSeverity, type MedicinePreset } from '@/lib/records';

const TEMP_PRESETS = [36.5, 36.8, 37.3, 38.0, 38.5] as const;
const TEETH_PRESETS = ['下中切牙（第 1 颗）', '下中切牙（第 2 颗）', '上中切牙', '侧切牙'] as const;

interface HealthFieldsProps {
  readonly state: HealthFormState;
  readonly medicinePresets: readonly MedicinePreset[];
  readonly onChange: (patch: Partial<HealthFormState>) => void;
}

export function HealthFields({ state, medicinePresets, onChange }: HealthFieldsProps) {
  const parsedTemp = parseOptionalStrictNumber(state.temperatureText);
  const hasValidTemp =
    parsedTemp !== null &&
    parsedTemp !== 'invalid' &&
    parsedTemp >= HEALTH_BOUNDS.tempMin &&
    parsedTemp <= HEALTH_BOUNDS.tempMax;
  const tempSeverity = hasValidTemp ? getTemperatureSeverity(parsedTemp) : null;

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
            unitAriaLabel="度"
            placeholder="36.6"
            inputAriaLabel="体温数值"
            min={HEALTH_BOUNDS.tempMin}
            max={HEALTH_BOUNDS.tempMax}
            step={HEALTH_BOUNDS.tempStep}
            defaultValue={HEALTH_BOUNDS.tempDefault}
            precision={1}
            onChange={(temperatureText) => onChange({ temperatureText })}
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
          <p className="text-xs text-muted-foreground">至少填写一项即可保存</p>
          <div className="grid grid-cols-3 gap-2.5">
            <Field>
              <FieldLabel htmlFor="growth-weight">体重（kg）</FieldLabel>
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
              <FieldLabel htmlFor="growth-height">身高（cm）</FieldLabel>
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
              <FieldLabel htmlFor="growth-head">头围（cm）</FieldLabel>
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
