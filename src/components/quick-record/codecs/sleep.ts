import { parseISO, subMinutes } from 'date-fns';
import type { CategoryBuildResult } from '@/components/quick-record/codecs/types';
import type { SleepInput, SleepRecord, SleepSubtype, SmartDefaults } from '@/lib/records';
import { combineLocalDateTimeToISO, formatDurationMin, guessSleepSubtype, splitLocalDateTime } from '@/lib/time';

const SLEEP_BOUNDS = {
  minMin: 1,
  maxMin: 24 * 60,
  defaultNapMin: 60,
  defaultNightMin: 480,
} as const;

export interface SleepFormState {
  subtype: SleepSubtype;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

interface SleepBuildContext {
  readonly note: string;
  readonly editId?: number;
}

/** 统一计算睡眠草稿的分钟数，作为界面预览与提交校验的单一事实来源。 */
export function computeSleepDurationMin(
  state: Pick<SleepFormState, 'startDate' | 'startTime' | 'endDate' | 'endTime'>,
): number {
  const st = combineLocalDateTimeToISO(state.startDate, state.startTime);
  const et = combineLocalDateTimeToISO(state.endDate, state.endTime);
  if (!st || !et) return 0;
  return Math.round((new Date(et).getTime() - new Date(st).getTime()) / 60000);
}

/** 按当前时段猜测白天小睡/夜间整觉，并结合习惯中位数时长倒推默认入睡时刻。 */
export function createDefaultSleepForm(now: Date, initialSubtype?: string, defaults?: SmartDefaults): SleepFormState {
  const subtype: SleepSubtype =
    initialSubtype === 'nap' || initialSubtype === 'night' ? initialSubtype : guessSleepSubtype(now);
  const defaultMin =
    subtype === 'night'
      ? (defaults?.sleep.suggested_night_min ?? SLEEP_BOUNDS.defaultNightMin)
      : (defaults?.sleep.suggested_nap_min ?? SLEEP_BOUNDS.defaultNapMin);
  const startParts = splitLocalDateTime(subMinutes(now, defaultMin));
  const endParts = splitLocalDateTime(now);
  return {
    subtype,
    startDate: startParts.date,
    startTime: startParts.time,
    endDate: endParts.date,
    endTime: endParts.time,
  };
}

/** 从既有睡眠记录还原表单状态：编辑态保留原始起止时刻，“再记一笔”态保留原时长并将醒来时间对齐到当前时刻。 */
export function sleepFormFromRecord(record: SleepRecord, now: Date, useOriginalTime: boolean): SleepFormState {
  if (useOriginalTime) {
    const st = splitLocalDateTime(parseISO(record.started_at));
    const et = splitLocalDateTime(parseISO(record.ended_at));
    return {
      subtype: record.subtype,
      startDate: st.date,
      startTime: st.time,
      endDate: et.date,
      endTime: et.time,
    };
  }
  const nowParts = splitLocalDateTime(now);
  const st = splitLocalDateTime(subMinutes(now, record.duration_min));
  return {
    subtype: record.subtype,
    startDate: st.date,
    startTime: st.time,
    endDate: nowParts.date,
    endTime: nowParts.time,
  };
}

/** 校验睡眠起止时刻与 1 分钟至 24 小时合法时长区间并组装提交载荷。 */
export function validateAndBuildSleepSubmission(state: SleepFormState, ctx: SleepBuildContext): CategoryBuildResult {
  const startedAt = combineLocalDateTimeToISO(state.startDate, state.startTime);
  const endedAt = combineLocalDateTimeToISO(state.endDate, state.endTime);
  if (!startedAt || !endedAt) {
    return { ok: false, error: '请选择有效的入睡与醒来时间' };
  }

  const durationMin = computeSleepDurationMin(state);
  if (durationMin < SLEEP_BOUNDS.minMin) {
    return { ok: false, error: '醒来时间必须晚于入睡时间' };
  }
  if (durationMin > SLEEP_BOUNDS.maxMin) {
    return { ok: false, error: '单次睡眠时长不能超过 24 小时' };
  }

  const payload: SleepInput = {
    subtype: state.subtype,
    started_at: startedAt,
    ended_at: endedAt,
    note: ctx.note,
  };

  if (ctx.editId !== undefined) {
    return {
      ok: true,
      request: { category: 'sleep', id: ctx.editId, payload },
      toastTitle: '睡眠记录已更新',
    };
  }
  return {
    ok: true,
    request: { category: 'sleep', payload },
    toastTitle: '已记录一笔睡眠',
    toastDescription: formatDurationMin(durationMin),
  };
}
