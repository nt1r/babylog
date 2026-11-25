import type { CategoryBuildResult } from '@/components/quick-record/codecs/types';
import { parseStrictInt } from '@/lib/number';
import type {
  BreastSide,
  FeedingInput,
  FeedingMode,
  FeedingRecord,
  FeedingSubtype,
  SmartDefaults,
  SolidAcceptance,
  SolidFoodPreset,
} from '@/lib/records';
import { combineLocalDateTimeToISO } from '@/lib/time';

/** 喂养数值边界与步进配置（milkMin < milkStepMin 用于保证手输小奶量时步进控件单调不反向）。 */
export const FEEDING_BOUNDS = {
  milkMin: 1,
  milkStepMin: 10,
  milkMax: 1000,
  milkStep: 10,
  milkDefault: 90,
  breastMin: 1,
  breastMax: 180,
  breastStep: 5,
  breastDefault: 15,
} as const;

const MILK_FREQUENT_FALLBACKS = [60, 90, 120] as const;
const SOLID_FOOD_FALLBACKS: readonly SolidFoodPreset[] = [
  { food: '高铁米粉', amount: '' },
  { food: '南瓜泥', amount: '' },
  { food: '苹果泥', amount: '' },
  { food: '蛋黄', amount: '' },
  { food: '蔬菜粥', amount: '' },
];

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
}

/** 合并智能默认值与冷启动兜底，解析喂养表单的高频奶量、辅食与亲喂侧别建议。 */
export function resolveFeedingPresets(defaults?: SmartDefaults): {
  frequentMilk: readonly number[];
  solidPresets: readonly SolidFoodPreset[];
  lastBreastSide: BreastSide | null;
  suggestedBreastSide: BreastSide;
} {
  return {
    frequentMilk: defaults?.feeding.frequent_milk_ml ?? MILK_FREQUENT_FALLBACKS,
    solidPresets:
      defaults && defaults.feeding.recent_solids.length > 0 ? defaults.feeding.recent_solids : SOLID_FOOD_FALLBACKS,
    lastBreastSide: defaults?.feeding.last_breast_side ?? null,
    suggestedBreastSide: defaults?.feeding.suggested_breast_side ?? 'left',
  };
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

  const parsedML = parseStrictInt(state.amountMLText);
  const parsedMin = parseStrictInt(state.breastMinText);

  if (
    (state.subtype === 'formula' || (state.subtype === 'breast' && state.feedingMode === 'bottle')) &&
    (parsedML === null || parsedML < FEEDING_BOUNDS.milkMin || parsedML > FEEDING_BOUNDS.milkMax)
  ) {
    return { ok: false, error: `请输入 ${FEEDING_BOUNDS.milkMin} 至 ${FEEDING_BOUNDS.milkMax} ml 之间的有效奶量` };
  }
  if (
    state.subtype === 'breast' &&
    state.feedingMode === 'direct' &&
    (parsedMin === null || parsedMin < FEEDING_BOUNDS.breastMin || parsedMin > FEEDING_BOUNDS.breastMax)
  ) {
    return {
      ok: false,
      error: `请输入 ${FEEDING_BOUNDS.breastMin} 至 ${FEEDING_BOUNDS.breastMax} 分钟之间的有效亲喂时长`,
    };
  }
  if (state.subtype === 'solid' && !state.solidFood.trim()) {
    return { ok: false, error: '请填写辅食内容' };
  }

  const payload: FeedingInput =
    state.subtype === 'formula'
      ? { subtype: 'formula', amount_ml: parsedML, recorded_at: recordedAt, note: ctx.note }
      : state.subtype === 'breast'
        ? state.feedingMode === 'bottle'
          ? {
              subtype: 'breast',
              feeding_mode: 'bottle',
              amount_ml: parsedML,
              recorded_at: recordedAt,
              note: ctx.note,
            }
          : {
              subtype: 'breast',
              feeding_mode: 'direct',
              breast_side: state.breastSide,
              duration_min: parsedMin,
              recorded_at: recordedAt,
              note: ctx.note,
            }
        : {
            subtype: 'solid',
            solid_food: state.solidFood.trim(),
            solid_amount: state.solidAmount.trim() || null,
            acceptance: state.acceptance || null,
            recorded_at: recordedAt,
            note: ctx.note,
          };

  return {
    ok: true,
    request: { category: 'feeding', id: ctx.editId, payload },
    toastTitle: ctx.editId !== undefined ? '喂养记录已更新' : '已记录一笔喂养',
  };
}
