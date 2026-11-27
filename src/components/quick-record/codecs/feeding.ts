import {
  buildDirectBreastInput,
  buildMilkFeedingInput,
  type CategoryBuildResult,
  FEEDING_BOUNDS,
  validateNotFutureTimestamp,
  validateRecordNote,
} from '@/lib/record-codecs';
import type {
  BreastSide,
  FeedingInput,
  FeedingMode,
  FeedingRecord,
  FeedingSubtype,
  SmartDefaults,
  SolidAcceptance,
} from '@/lib/records';
import { combineLocalDateTimeToISO } from '@/lib/time';

export interface FeedingFormState {
  subtype: FeedingSubtype;
  feedingMode: FeedingMode;
  breastSide: BreastSide;
  amountMLText: string;
  breastMinText: string;
  solidFood: string;
  solidAmount: string;
  acceptance: SolidAcceptance | '';
}

interface FeedingBuildContext {
  readonly dateStr: string;
  readonly timeStr: string;
  readonly note: string;
  readonly editId?: number;
  readonly now?: Date;
}

/** 基于初始子类型与智能默认值构建新建态喂养表单状态。 */
export function createDefaultFeedingForm(initialSubtype?: string, defaults?: SmartDefaults): FeedingFormState {
  const subtype: FeedingSubtype =
    initialSubtype === 'breast' || initialSubtype === 'formula' || initialSubtype === 'solid'
      ? initialSubtype
      : (defaults?.feeding.last_feeding_subtype ?? 'formula');

  return {
    subtype,
    feedingMode: defaults?.feeding.last_breast_mode ?? 'direct',
    breastSide: defaults?.feeding.suggested_breast_side ?? 'left',
    amountMLText: String(defaults?.feeding.last_milk_ml ?? FEEDING_BOUNDS.milkDefault),
    breastMinText: String(defaults?.feeding.last_breast_duration_min ?? FEEDING_BOUNDS.breastDefault),
    solidFood: '',
    solidAmount: '',
    acceptance: '',
  };
}

/** 将后端喂养记录 DTO 回填为受控字符串表单状态。 */
export function feedingFormFromRecord(record: FeedingRecord, defaults?: SmartDefaults): FeedingFormState {
  return {
    subtype: record.subtype,
    feedingMode: record.feeding_mode ?? 'direct',
    breastSide: record.breast_side ?? defaults?.feeding.suggested_breast_side ?? 'left',
    amountMLText: String(record.amount_ml ?? defaults?.feeding.last_milk_ml ?? FEEDING_BOUNDS.milkDefault),
    breastMinText: String(record.duration_min ?? FEEDING_BOUNDS.breastDefault),
    solidFood: record.solid_food ?? '',
    solidAmount: record.solid_amount ?? '',
    acceptance: record.acceptance ?? '',
  };
}

/** 仅校验当前激活子类型可见字段并组装喂养提交载荷（隐藏子类型字段不参与校验）。 */
export function validateAndBuildFeedingSubmission(
  state: FeedingFormState,
  ctx: FeedingBuildContext,
): CategoryBuildResult {
  const recordedAt = combineLocalDateTimeToISO(ctx.dateStr, ctx.timeStr);
  if (!recordedAt) {
    return { ok: false, error: '请选择有效的喂养日期与时间' };
  }
  const timeErr = validateNotFutureTimestamp(recordedAt, ctx.now);
  if (timeErr) {
    return { ok: false, error: timeErr };
  }
  const noteResult = validateRecordNote(ctx.note);
  if (!noteResult.ok) {
    return noteResult;
  }

  let payload: FeedingInput;
  if (state.subtype === 'formula') {
    const built = buildMilkFeedingInput({
      kind: 'formula',
      amountText: state.amountMLText,
      recordedAt,
      note: noteResult.note,
    });
    if (!built.ok) return built;
    payload = built.payload;
  } else if (state.subtype === 'breast') {
    if (state.feedingMode === 'bottle') {
      const built = buildMilkFeedingInput({
        kind: 'bottle_breast',
        amountText: state.amountMLText,
        recordedAt,
        note: noteResult.note,
      });
      if (!built.ok) return built;
      payload = built.payload;
    } else {
      const built = buildDirectBreastInput({
        side: state.breastSide,
        durationText: state.breastMinText,
        recordedAt,
        note: noteResult.note,
      });
      if (!built.ok) return built;
      payload = built.payload;
    }
  } else {
    if (!state.solidFood.trim()) {
      return { ok: false, error: '请填写辅食内容' };
    }
    payload = {
      subtype: 'solid',
      solid_food: state.solidFood.trim(),
      solid_amount: state.solidAmount.trim() || null,
      acceptance: state.acceptance || null,
      recorded_at: recordedAt,
      note: noteResult.note,
    };
  }

  return {
    ok: true,
    request: { category: 'feeding', id: ctx.editId, payload },
    toastTitle: ctx.editId !== undefined ? '喂养记录已更新' : '已记录一笔喂养',
  };
}
