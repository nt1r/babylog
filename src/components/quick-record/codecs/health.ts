import type { CategoryBuildResult } from '@/components/quick-record/codecs/types';
import { parseOptionalStrictNumber } from '@/lib/number';
import type { HealthInput, HealthRecord, MedicinePreset, SmartDefaults } from '@/lib/records';
import { combineLocalDateTimeToISO } from '@/lib/time';

export const HEALTH_BOUNDS = {
  tempMin: 34.0,
  tempMax: 43.0,
  tempStep: 0.1,
  tempDefault: 36.6,
} as const;

const MEDICINE_FALLBACKS: readonly MedicinePreset[] = [
  { name: '维生素 D3', dosage: '1 粒' },
  { name: '维生素 AD', dosage: '1 粒' },
];

type ClinicalHealthSubtype = 'temperature' | 'medicine';

export interface HealthFormState {
  subtype: ClinicalHealthSubtype;
  temperatureText: string;
  medicineName: string;
  medicineDosage: string;
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
  const subtype: ClinicalHealthSubtype = initialSubtype === 'medicine' ? 'medicine' : 'temperature';
  return {
    subtype,
    temperatureText: (defaults?.health.last_temperature_c ?? HEALTH_BOUNDS.tempDefault).toFixed(1),
    medicineName: '',
    medicineDosage: '',
  };
}

export function healthFormFromRecord(record: HealthRecord, defaults?: SmartDefaults): HealthFormState {
  return {
    subtype: record.subtype === 'medicine' ? 'medicine' : 'temperature',
    temperatureText: (record.temperature_c ?? defaults?.health.last_temperature_c ?? HEALTH_BOUNDS.tempDefault).toFixed(
      1,
    ),
    medicineName: record.medicine_name ?? '',
    medicineDosage: record.medicine_dosage ?? '',
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

  const payload: HealthInput =
    state.subtype === 'temperature'
      ? {
          subtype: 'temperature',
          temperature_c: parsedTemp === 'invalid' ? null : parsedTemp,
          recorded_at: recordedAt,
          note: ctx.note,
        }
      : {
          subtype: 'medicine',
          medicine_name: state.medicineName.trim(),
          medicine_dosage: state.medicineDosage.trim() || null,
          recorded_at: recordedAt,
          note: ctx.note,
        };

  return {
    ok: true,
    request: { category: 'health', id: ctx.editId, payload },
    toastTitle: ctx.editId !== undefined ? '健康记录已更新' : '已记录一笔健康数据',
  };
}
