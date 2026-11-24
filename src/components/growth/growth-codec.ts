import type { CategoryBuildResult } from '@/components/quick-record/codecs/types';
import { parseOptionalStrictNumber } from '@/lib/number';
import type { HealthInput } from '@/lib/records';
import { combineLocalDateTimeToISO, formatLocalDateKey, getLocalDateKeyFromISO, parseLocalDateKey } from '@/lib/time';
import type { GrowthEntrySubtype, GrowthRecordIntent } from '@/stores/growth-record';

const GROWTH_BOUNDS = {
  weightMin: 0.3,
  weightMax: 40.0,
  heightMin: 20.0,
  heightMax: 150.0,
  headMin: 20.0,
  headMax: 70.0,
} as const;

export const TEETH_PRESETS = ['下中切牙（第 1 颗）', '下中切牙（第 2 颗）', '上中切牙', '侧切牙'] as const;

export interface GrowthFormState {
  subtype: GrowthEntrySubtype;
  dateStr: string;
  weightKg: string;
  heightCm: string;
  headCm: string;
  toothNote: string;
  note: string;
}

/** 按打开意图初始化生长发育表单（仅选日期，不含分钟级时间偏移）。 */
export function createGrowthFormState(intent: GrowthRecordIntent, now: Date): GrowthFormState {
  if (intent.mode === 'create') {
    return {
      subtype: intent.initialSubtype,
      dateStr: formatLocalDateKey(now),
      weightKg: '',
      heightCm: '',
      headCm: '',
      toothNote: '',
      note: '',
    };
  }

  const { record } = intent;
  return {
    subtype: record.subtype === 'teeth' ? 'teeth' : 'growth',
    dateStr: getLocalDateKeyFromISO(record.recorded_at) || formatLocalDateKey(now),
    weightKg: record.weight_kg !== null ? String(record.weight_kg) : '',
    heightCm: record.height_cm !== null ? String(record.height_cm) : '',
    headCm: record.head_cm !== null ? String(record.head_cm) : '',
    toothNote: record.tooth_note ?? '',
    note: record.note,
  };
}

/**
 * 将纯日期输入转为后端所需的 RFC3339 时间戳：
 * - 编辑态且日期未改：保留原记录时间戳；
 * - 选今天：使用当前时刻（避免本地未到 12:00 时触发未来时间拦截）；
 * - 选历史日期：默认使用当天本地 12:00。
 */
function resolveGrowthRecordedAtISO(dateStr: string, intent: GrowthRecordIntent, now: Date): string | null {
  if (!parseLocalDateKey(dateStr)) return null;
  const todayKey = formatLocalDateKey(now);
  if (dateStr > todayKey) return null;

  if (intent.mode === 'edit' && getLocalDateKeyFromISO(intent.record.recorded_at) === dateStr) {
    return intent.record.recorded_at;
  }
  if (dateStr === todayKey) {
    return now.toISOString();
  }
  return combineLocalDateTimeToISO(dateStr, '12:00');
}

/** 校验生长/长牙表单并组装提交载荷。 */
export function validateAndBuildGrowthSubmission(
  state: GrowthFormState,
  intent: GrowthRecordIntent,
  now: Date,
): CategoryBuildResult {
  const todayKey = formatLocalDateKey(now);
  if (!parseLocalDateKey(state.dateStr)) {
    return { ok: false, error: '请选择有效的记录日期' };
  }
  if (state.dateStr > todayKey) {
    return { ok: false, error: '记录日期不能晚于今天' };
  }

  const recordedAt = resolveGrowthRecordedAtISO(state.dateStr, intent, now);
  if (!recordedAt) {
    return { ok: false, error: '请选择有效的记录日期' };
  }

  const editId = intent.mode === 'edit' ? intent.record.id : undefined;

  if (state.subtype === 'teeth') {
    if (!state.toothNote.trim()) {
      return { ok: false, error: '请填写萌出牙位或说明' };
    }
    const payload: HealthInput = {
      subtype: 'teeth',
      tooth_note: state.toothNote.trim(),
      recorded_at: recordedAt,
      note: state.note.trim(),
    };
    return {
      ok: true,
      request: { category: 'health', id: editId, payload },
      toastTitle: editId !== undefined ? '出牙记录已更新' : '已记录一笔出牙动态',
    };
  }

  const parsedWeight = parseOptionalStrictNumber(state.weightKg);
  const parsedHeight = parseOptionalStrictNumber(state.heightCm);
  const parsedHead = parseOptionalStrictNumber(state.headCm);

  if (
    parsedWeight === 'invalid' ||
    (parsedWeight !== null && (parsedWeight < GROWTH_BOUNDS.weightMin || parsedWeight > GROWTH_BOUNDS.weightMax))
  ) {
    return { ok: false, error: '体重应在 0.3 至 40.0 kg 之间' };
  }
  if (
    parsedHeight === 'invalid' ||
    (parsedHeight !== null && (parsedHeight < GROWTH_BOUNDS.heightMin || parsedHeight > GROWTH_BOUNDS.heightMax))
  ) {
    return { ok: false, error: '身高应在 20.0 至 150.0 cm 之间' };
  }
  if (
    parsedHead === 'invalid' ||
    (parsedHead !== null && (parsedHead < GROWTH_BOUNDS.headMin || parsedHead > GROWTH_BOUNDS.headMax))
  ) {
    return { ok: false, error: '头围应在 20.0 至 70.0 cm 之间' };
  }
  if (parsedWeight === null && parsedHeight === null && parsedHead === null) {
    return { ok: false, error: '体重、身高、头围请至少填写一项' };
  }

  const payload: HealthInput = {
    subtype: 'growth',
    weight_kg: parsedWeight,
    height_cm: parsedHeight,
    head_cm: parsedHead,
    recorded_at: recordedAt,
    note: state.note.trim(),
  };

  return {
    ok: true,
    request: { category: 'health', id: editId, payload },
    toastTitle: editId !== undefined ? '生长记录已更新' : '已记录一笔生长数据',
  };
}
