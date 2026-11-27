import { addDays, addHours } from 'date-fns';
import { parseStrictInt } from '@/lib/number';
import {
  buildDiaperCareInput,
  buildDirectBreastInput,
  buildMilkFeedingInput,
  FEEDING_BOUNDS,
  validateNotFutureTimestamp,
  validateRecordNote,
} from '@/lib/record-codecs';
import {
  type BatchCreateRecordsInput,
  type BatchUndoTarget,
  BREAST_SIDE_LABELS,
  type BreastSide,
  type CareInput,
  DIAPER_KIND_LABELS,
  type DiaperKind,
  type FeedingInput,
  type StoolColor,
  type StoolConsistency,
} from '@/lib/records';
import {
  combineLocalDateTimeToISO,
  formatLocalDateKey,
  formatShortCnDate,
  parseLocalDateKey,
  splitLocalDateTime,
} from '@/lib/time';

const RELATIVE_HOUR_OFFSETS = [-3, -2, 2, 3] as const;

export interface BatchRecordDraft {
  dateStr: string;
  timeStr: string;
  directBreastSide: BreastSide | '';
  directBreastMinText: string;
  bottleBreastMLText: string;
  formulaMLText: string;
  hasPee: boolean;
  hasPoop: boolean;
  stoolConsistency: StoolConsistency | '';
  stoolColor: StoolColor | '';
  note: string;
}

export interface BatchSessionEntry {
  readonly id: string;
  readonly dateStr: string;
  readonly timeStr: string;
  readonly summaryLabel: string;
  readonly usedBreastSide: BreastSide | null;
  readonly targets: readonly BatchUndoTarget[];
}

export interface RelativeTimeChip {
  readonly offsetHours: number;
  readonly label: string;
  readonly dateStr: string;
  readonly timeStr: string;
}

type BatchBuildResult =
  | {
      readonly ok: true;
      readonly input: BatchCreateRecordsInput;
      readonly count: number;
      readonly summaryLabel: string;
      readonly usedBreastSide: BreastSide | null;
    }
  | { readonly ok: false; readonly error: string };

function formatDirectBreastLabel(side: BreastSide, min: number | null): string {
  const sideLabel = BREAST_SIDE_LABELS[side].replace('侧', '');
  return min !== null && min > 0 ? `亲喂(${sideLabel} ${min} 分钟)` : `亲喂(${sideLabel})`;
}

function formatMilkLabel(prefix: '瓶喂母乳' | '配方奶', ml: number | null): string {
  return ml !== null && ml > 0 ? `${prefix} ${ml} ml` : prefix;
}

function resolveDiaperKind(hasPee: boolean, hasPoop: boolean): DiaperKind | null {
  if (hasPee && hasPoop) return 'both';
  if (hasPee) return 'pee';
  if (hasPoop) return 'poop';
  return null;
}

/** 构造首次打开批量补录抽屉时的空白草稿（五类项均默认跳过，仅初始化当前本地日期与时间）。 */
export function createInitialBatchDraft(now: Date = new Date()): BatchRecordDraft {
  const { date, time } = splitLocalDateTime(now);
  return {
    dateStr: date,
    timeStr: time,
    directBreastSide: '',
    directBreastMinText: '',
    bottleBreastMLText: '',
    formulaMLText: '',
    hasPee: false,
    hasPoop: false,
    stoolConsistency: '',
    stoolColor: '',
    note: '',
  };
}

/** 点击「保存并继续」后重置草稿：锁定当前补录日期、清空时间以防误重提，并清空五类项目与备注。 */
export function resetBatchDraftForContinue(prevDateStr: string): BatchRecordDraft {
  return {
    dateStr: prevDateStr,
    timeStr: '',
    directBreastSide: '',
    directBreastMinText: '',
    bottleBreastMLText: '',
    formulaMLText: '',
    hasPee: false,
    hasPoop: false,
    stoolConsistency: '',
    stoolColor: '',
    note: '',
  };
}

/** 按天前后微调补录日期，自动钳位至不晚于 maxDateStr（今天）。 */
export function shiftBatchDateStr(dateStr: string, deltaDays: number, maxDateStr: string): string {
  const base = parseLocalDateKey(dateStr) ?? parseLocalDateKey(maxDateStr);
  if (!base) return maxDateStr;
  const shifted = formatLocalDateKey(addDays(base, deltaDays));
  return shifted > maxDateStr ? maxDateStr : shifted;
}

/**
 * 基于上次已提交的时间点计算 -3h / -2h / +2h / +3h 快捷推演胶囊，
 * 自动过滤晚于当前时刻（now）的候选，跨午夜时在标签中附带短日期提示。
 */
export function buildRelativeTimeChips(
  anchorDateStr: string,
  anchorTimeStr: string,
  now: Date = new Date(),
): RelativeTimeChip[] {
  const anchorIso = combineLocalDateTimeToISO(anchorDateStr, anchorTimeStr);
  if (!anchorIso) return [];
  const anchorDate = new Date(anchorIso);
  if (Number.isNaN(anchorDate.getTime())) return [];

  const chips: RelativeTimeChip[] = [];
  for (const offsetHours of RELATIVE_HOUR_OFFSETS) {
    const candidate = addHours(anchorDate, offsetHours);
    if (candidate.getTime() > now.getTime()) continue;
    const { date, time } = splitLocalDateTime(candidate);
    const sign = offsetHours > 0 ? '+' : '';
    const datePrefix = date !== anchorDateStr ? `${formatShortCnDate(date, anchorDateStr)} ` : '';
    chips.push({
      offsetHours,
      label: `${datePrefix}${time} (${sign}${offsetHours}h)`,
      dateStr: date,
      timeStr: time,
    });
  }
  return chips;
}

/** 从最新优先的会话已补录清单中派生最近一次亲喂侧别，确保撤销含亲喂的批次后交替建议自动回退。 */
export function resolveLastSessionBreastSide(entries: readonly BatchSessionEntry[]): BreastSide | null {
  for (const entry of entries) {
    if (entry.usedBreastSide) return entry.usedBreastSide;
  }
  return null;
}

/** 计算连续补录场景下的建议亲喂侧别：优先交替本会话最近一次亲喂侧别，否则回退智能默认值。 */
export function resolveSessionSuggestedBreastSide(
  lastSessionSide: BreastSide | null,
  defaultSuggested: BreastSide,
): BreastSide {
  if (!lastSessionSide) return defaultSuggested;
  return lastSessionSide === 'left' ? 'right' : 'left';
}

/** 根据草稿生成底部实时预览摘要，直观展示本次提交将落库的记录条数与明细。 */
export function buildBatchPreview(draft: BatchRecordDraft): { count: number; parts: string[] } {
  const parts: string[] = [];

  if (draft.directBreastSide) {
    parts.push(formatDirectBreastLabel(draft.directBreastSide, parseStrictInt(draft.directBreastMinText)));
  }

  if (draft.bottleBreastMLText.trim()) {
    parts.push(formatMilkLabel('瓶喂母乳', parseStrictInt(draft.bottleBreastMLText)));
  }

  if (draft.formulaMLText.trim()) {
    parts.push(formatMilkLabel('配方奶', parseStrictInt(draft.formulaMLText)));
  }

  const diaperKind = resolveDiaperKind(draft.hasPee, draft.hasPoop);
  if (diaperKind) {
    parts.push(DIAPER_KIND_LABELS[diaperKind]);
  }

  return { count: parts.length, parts };
}

/**
 * 校验五类填即录入草稿并组装单事务批量提交载荷：
 * 留空项自动跳过，非空非法输入显式报错；排尿与排便同时勾选时合并为 1 条 `diaper_kind: "both"`，
 * 公共备注统一附带至本次生成的各条记录。
 */
export function validateAndBuildBatchSubmission(draft: BatchRecordDraft, now: Date = new Date()): BatchBuildResult {
  if (!draft.dateStr) {
    return { ok: false, error: '请选择记录日期' };
  }
  if (!draft.timeStr) {
    return { ok: false, error: '请选择记录时间' };
  }

  const recordedAt = combineLocalDateTimeToISO(draft.dateStr, draft.timeStr);
  if (!recordedAt) {
    return { ok: false, error: '请选择有效的记录日期与时间' };
  }
  const timeErr = validateNotFutureTimestamp(recordedAt, now);
  if (timeErr) {
    return { ok: false, error: timeErr };
  }

  const noteResult = validateRecordNote(draft.note);
  if (!noteResult.ok) {
    return noteResult;
  }
  const { note } = noteResult;

  const feedings: FeedingInput[] = [];
  const cares: CareInput[] = [];
  const summaryParts: string[] = [];
  let usedBreastSide: BreastSide | null = null;

  if (draft.directBreastSide) {
    const built = buildDirectBreastInput({
      side: draft.directBreastSide,
      durationText: draft.directBreastMinText,
      recordedAt,
      note,
      errorMessage: `亲喂时长应在 ${FEEDING_BOUNDS.breastMin} 至 ${FEEDING_BOUNDS.breastMax} 分钟之间`,
    });
    if (!built.ok) return built;
    usedBreastSide = draft.directBreastSide;
    feedings.push(built.payload);
    summaryParts.push(formatDirectBreastLabel(draft.directBreastSide, built.durationMin));
  }

  if (draft.bottleBreastMLText.trim() !== '') {
    const built = buildMilkFeedingInput({
      kind: 'bottle_breast',
      amountText: draft.bottleBreastMLText,
      recordedAt,
      note,
      errorMessage: `瓶喂母乳奶量应在 ${FEEDING_BOUNDS.milkMin} 至 ${FEEDING_BOUNDS.milkMax} ml 之间`,
    });
    if (!built.ok) return built;
    feedings.push(built.payload);
    summaryParts.push(formatMilkLabel('瓶喂母乳', built.amountML));
  }

  if (draft.formulaMLText.trim() !== '') {
    const built = buildMilkFeedingInput({
      kind: 'formula',
      amountText: draft.formulaMLText,
      recordedAt,
      note,
      errorMessage: `配方奶奶量应在 ${FEEDING_BOUNDS.milkMin} 至 ${FEEDING_BOUNDS.milkMax} ml 之间`,
    });
    if (!built.ok) return built;
    feedings.push(built.payload);
    summaryParts.push(formatMilkLabel('配方奶', built.amountML));
  }

  const diaperKind = resolveDiaperKind(draft.hasPee, draft.hasPoop);
  if (diaperKind) {
    cares.push(
      buildDiaperCareInput({
        diaperKind,
        stoolConsistency: draft.stoolConsistency,
        stoolColor: draft.stoolColor,
        recordedAt,
        note,
      }),
    );
    summaryParts.push(DIAPER_KIND_LABELS[diaperKind]);
  }

  const count = feedings.length + cares.length;
  if (count === 0) {
    return { ok: false, error: '请至少填写一项喂奶，或选择嘘嘘/便便' };
  }

  return {
    ok: true,
    input: { feedings, cares },
    count,
    summaryLabel: summaryParts.join(' · '),
    usedBreastSide,
  };
}
