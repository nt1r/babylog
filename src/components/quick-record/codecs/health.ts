import type { CategoryBuildResult } from '@/components/quick-record/codecs/types';
import { parseOptionalStrictNumber } from '@/lib/number';
import type { HealthInput, HealthRecord, HealthSubtype, MedicinePreset, SmartDefaults } from '@/lib/records';
import { combineLocalDateTimeToISO } from '@/lib/time';

export const HEALTH_BOUNDS = {
  tempMin: 34.0,
  tempMax: 43.0,
  tempStep: 0.1,
  tempDefault: 36.6,
  weightMin: 0.3,
  weightMax: 40.0,
  heightMin: 20.0,
  heightMax: 150.0,
  headMin: 20.0,
  headMax: 70.0,
} as const;

const MEDICINE_FALLBACKS: readonly MedicinePreset[] = [
  { name: '维生素 D3', dosage: '1 粒' },
  { name: '维生素 AD', dosage: '1 粒' },
];

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

interface HealthBuildContext {
  readonly dateStr: string;
  readonly timeStr: string;
  readonly note: string;
  readonly editId?: number;
}

export function resolveHealthPresets(defaults?: SmartDefaults): readonly MedicinePreset[] {
  return defaults && defaults.health.recent_medicines.length > 0
    ? defaults.health.recent_medicines
    : MEDICINE_FALLBACKS;
}

export function createDefaultHealthForm(initialSubtype?: string, defaults?: SmartDefaults): HealthFormState {
  const subtype: HealthSubtype =
    initialSubtype === 'temperature' ||
    initialSubtype === 'medicine' ||
    initialSubtype === 'growth' ||
    initialSubtype === 'teeth'
      ? initialSubtype
      : 'temperature';

  return {
    subtype,
    temperatureText: (defaults?.health.last_temperature_c ?? HEALTH_BOUNDS.tempDefault).toFixed(1),
    medicineName: '',
    medicineDosage: '',
    weightKg: '',
    heightCm: '',
    headCm: '',
    toothNote: '',
  };
}

export function healthFormFromRecord(record: HealthRecord, defaults?: SmartDefaults): HealthFormState {
  return {
    subtype: record.subtype,
    temperatureText: (record.temperature_c ?? defaults?.health.last_temperature_c ?? HEALTH_BOUNDS.tempDefault).toFixed(
      1,
    ),
    medicineName: record.medicine_name ?? '',
    medicineDosage: record.medicine_dosage ?? '',
    weightKg: record.weight_kg !== null ? String(record.weight_kg) : '',
    heightCm: record.height_cm !== null ? String(record.height_cm) : '',
    headCm: record.head_cm !== null ? String(record.head_cm) : '',
    toothNote: record.tooth_note ?? '',
  };
}

export function validateAndBuildHealthSubmission(state: HealthFormState, ctx: HealthBuildContext): CategoryBuildResult {
  const recordedAt = combineLocalDateTimeToISO(ctx.dateStr, ctx.timeStr);
  if (!recordedAt) {
    return { ok: false, error: '请选择有效的记录日期与时间' };
  }

  const parsedTemp = parseOptionalStrictNumber(state.temperatureText);
  if (
    state.subtype === 'temperature' &&
    (parsedTemp === null ||
      parsedTemp === 'invalid' ||
      parsedTemp < HEALTH_BOUNDS.tempMin ||
      parsedTemp > HEALTH_BOUNDS.tempMax)
  ) {
    return {
      ok: false,
      error: `请输入 ${HEALTH_BOUNDS.tempMin.toFixed(1)} 至 ${HEALTH_BOUNDS.tempMax.toFixed(1)} ℃ 之间的有效体温`,
    };
  }
  if (state.subtype === 'medicine' && !state.medicineName.trim()) {
    return { ok: false, error: '请填写药品或营养剂名称' };
  }
  if (state.subtype === 'teeth' && !state.toothNote.trim()) {
    return { ok: false, error: '请填写萌出牙位或说明' };
  }

  const parsedWeight = parseOptionalStrictNumber(state.weightKg);
  const parsedHeight = parseOptionalStrictNumber(state.heightCm);
  const parsedHead = parseOptionalStrictNumber(state.headCm);

  if (state.subtype === 'growth') {
    if (
      parsedWeight === 'invalid' ||
      (parsedWeight !== null && (parsedWeight < HEALTH_BOUNDS.weightMin || parsedWeight > HEALTH_BOUNDS.weightMax))
    ) {
      return { ok: false, error: '体重应在 0.3 至 40.0 kg 之间' };
    }
    if (
      parsedHeight === 'invalid' ||
      (parsedHeight !== null && (parsedHeight < HEALTH_BOUNDS.heightMin || parsedHeight > HEALTH_BOUNDS.heightMax))
    ) {
      return { ok: false, error: '身高应在 20.0 至 150.0 cm 之间' };
    }
    if (
      parsedHead === 'invalid' ||
      (parsedHead !== null && (parsedHead < HEALTH_BOUNDS.headMin || parsedHead > HEALTH_BOUNDS.headMax))
    ) {
      return { ok: false, error: '头围应在 20.0 至 70.0 cm 之间' };
    }
    if (parsedWeight === null && parsedHeight === null && parsedHead === null) {
      return { ok: false, error: '体重、身高、头围请至少填写一项' };
    }
  }

  const payload: HealthInput =
    state.subtype === 'temperature'
      ? {
          subtype: 'temperature',
          temperature_c: parsedTemp === 'invalid' ? null : parsedTemp,
          recorded_at: recordedAt,
          note: ctx.note,
        }
      : state.subtype === 'medicine'
        ? {
            subtype: 'medicine',
            medicine_name: state.medicineName.trim(),
            medicine_dosage: state.medicineDosage.trim() || null,
            recorded_at: recordedAt,
            note: ctx.note,
          }
        : state.subtype === 'growth'
          ? {
              subtype: 'growth',
              weight_kg: parsedWeight === 'invalid' ? null : parsedWeight,
              height_cm: parsedHeight === 'invalid' ? null : parsedHeight,
              head_cm: parsedHead === 'invalid' ? null : parsedHead,
              recorded_at: recordedAt,
              note: ctx.note,
            }
          : { subtype: 'teeth', tooth_note: state.toothNote.trim(), recorded_at: recordedAt, note: ctx.note };

  return {
    ok: true,
    request: { category: 'health', id: ctx.editId, payload },
    toastTitle: ctx.editId !== undefined ? '健康记录已更新' : '已记录一笔健康数据',
  };
}
