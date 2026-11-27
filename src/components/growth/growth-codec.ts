import { parseOptionalStrictNumber } from '@/lib/number';
import { type CategoryBuildResult, validateRecordNote } from '@/lib/record-codecs';
import type { HealthInput } from '@/lib/records';
import { combineLocalDateTimeToISO, formatLocalDateKey, getLocalDateKeyFromISO, parseLocalDateKey } from '@/lib/time';
import type { GrowthEntrySubtype, GrowthRecordIntent } from '@/stores/overlays';

const GROWTH_BOUNDS = {
  weightMin: 0.3,
  weightMax: 40.0,
  heightMin: 20.0,
  heightMax: 150.0,
  headMin: 20.0,
  headMax: 70.0,
} as const;

// 婴幼儿 20 颗乳牙常见萌出顺序表（按颗次 1..20），用于根据累计已出牙数动态推荐下一颗预设。
const DECIDUOUS_ERUPTION_STAGES: ReadonlyArray<{ readonly label: string; readonly count: number }> = [
  { label: '下中切牙', count: 2 },
  { label: '上中切牙', count: 2 },
  { label: '上侧切牙', count: 2 },
  { label: '下侧切牙', count: 2 },
  { label: '第一乳磨牙', count: 4 },
  { label: '乳尖牙', count: 4 },
  { label: '第二乳磨牙', count: 4 },
];

function findEruptionStageIndex(toothIndex: number): number {
  let cumulative = 0;
  for (let i = 0; i < DECIDUOUS_ERUPTION_STAGES.length; i++) {
    cumulative += DECIDUOUS_ERUPTION_STAGES[i].count;
    if (toothIndex <= cumulative) {
      return i;
    }
  }
  return DECIDUOUS_ERUPTION_STAGES.length - 1;
}

/**
 * 根据累计已记录的出牙颗数动态生成 4 个常用牙位预设：
 * 首项优先给出按常规萌出顺序推算的下一颗（带「第 N 颗」序号），其余补齐相邻萌出阶段牙位。
 */
export function buildDynamicTeethPresets(teethCount: number): readonly string[] {
  const safeCount = Number.isFinite(teethCount) && teethCount > 0 ? Math.floor(teethCount) : 0;
  const nextNum = Math.min(20, safeCount + 1);
  const stageIdx = findEruptionStageIndex(nextNum);

  const presets: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    if (!seen.has(text)) {
      seen.add(text);
      presets.push(text);
    }
  };

  push(`${DECIDUOUS_ERUPTION_STAGES[stageIdx].label}（第 ${nextNum} 颗）`);
  if (nextNum < 20) {
    const afterNext = nextNum + 1;
    const afterStage = DECIDUOUS_ERUPTION_STAGES[findEruptionStageIndex(afterNext)];
    push(`${afterStage.label}（第 ${afterNext} 颗）`);
  }

  for (let offset = 1; offset < DECIDUOUS_ERUPTION_STAGES.length && presets.length < 4; offset++) {
    const candidate = DECIDUOUS_ERUPTION_STAGES[stageIdx + offset] ?? DECIDUOUS_ERUPTION_STAGES[stageIdx - offset];
    if (candidate) {
      push(candidate.label);
    }
  }

  return presets.slice(0, 4);
}

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
  const noteResult = validateRecordNote(state.note);
  if (!noteResult.ok) {
    return noteResult;
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
      note: noteResult.note,
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
    note: noteResult.note,
  };

  return {
    ok: true,
    request: { category: 'health', id: editId, payload },
    toastTitle: editId !== undefined ? '生长记录已更新' : '已记录一笔生长数据',
  };
}
