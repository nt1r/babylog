import {
  buildDiaperCareInput,
  type CategoryBuildResult,
  validateNotFutureTimestamp,
  validateRecordNote,
} from '@/lib/record-codecs';
import type {
  CareInput,
  CareRecord,
  CareSubtype,
  DiaperKind,
  SmartDefaults,
  StoolColor,
  StoolConsistency,
} from '@/lib/records';
import { combineLocalDateTimeToISO } from '@/lib/time';

const CARE_OTHER_FALLBACKS = ['剪指甲', '抚触按摩', '洗鼻子', '涂润肤露'] as const;

export interface CareFormState {
  subtype: CareSubtype;
  diaperKind: DiaperKind;
  stoolConsistency: StoolConsistency | '';
  stoolColor: StoolColor | '';
  careTitle: string;
}

interface CareBuildContext {
  readonly dateStr: string;
  readonly timeStr: string;
  readonly note: string;
  readonly editId?: number;
  readonly now?: Date;
}

/** 合并最近自定义护理标题与默认建议并去重截断至最多 6 项。 */
export function resolveCarePresets(defaults?: SmartDefaults): readonly string[] {
  if (defaults && defaults.care.recent_other_titles.length > 0) {
    return Array.from(new Set([...defaults.care.recent_other_titles, ...CARE_OTHER_FALLBACKS])).slice(0, 6);
  }
  return CARE_OTHER_FALLBACKS;
}

export function createDefaultCareForm(initialSubtype?: string): CareFormState {
  const subtype: CareSubtype =
    initialSubtype === 'diaper' || initialSubtype === 'bath' || initialSubtype === 'other' ? initialSubtype : 'diaper';
  return {
    subtype,
    diaperKind: 'pee',
    stoolConsistency: '',
    stoolColor: '',
    careTitle: '',
  };
}

export function careFormFromRecord(record: CareRecord): CareFormState {
  return {
    subtype: record.subtype,
    diaperKind: record.diaper_kind ?? 'pee',
    stoolConsistency: record.stool_consistency ?? '',
    stoolColor: record.stool_color ?? '',
    careTitle: record.care_title ?? '',
  };
}

/** 校验日常护理表单并组装提交载荷（仅嘘嘘时强制丢弃隐藏的大便性状与颜色字段置 null）。 */
export function validateAndBuildCareSubmission(state: CareFormState, ctx: CareBuildContext): CategoryBuildResult {
  const recordedAt = combineLocalDateTimeToISO(ctx.dateStr, ctx.timeStr);
  if (!recordedAt) {
    return { ok: false, error: '请选择有效的护理日期与时间' };
  }
  const timeErr = validateNotFutureTimestamp(recordedAt, ctx.now);
  if (timeErr) {
    return { ok: false, error: timeErr };
  }
  const noteResult = validateRecordNote(ctx.note);
  if (!noteResult.ok) {
    return noteResult;
  }
  if (state.subtype === 'other' && !state.careTitle.trim()) {
    return { ok: false, error: '请填写护理内容' };
  }

  const payload: CareInput =
    state.subtype === 'diaper'
      ? buildDiaperCareInput({
          diaperKind: state.diaperKind,
          stoolConsistency: state.stoolConsistency,
          stoolColor: state.stoolColor,
          recordedAt,
          note: noteResult.note,
        })
      : state.subtype === 'bath'
        ? { subtype: 'bath', recorded_at: recordedAt, note: noteResult.note }
        : { subtype: 'other', care_title: state.careTitle.trim(), recorded_at: recordedAt, note: noteResult.note };

  return {
    ok: true,
    request: { category: 'care', id: ctx.editId, payload },
    toastTitle: ctx.editId !== undefined ? '护理记录已更新' : '已记录一笔护理',
  };
}
