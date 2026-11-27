import { parseStrictInt } from '@/lib/number';
import {
  type BreastSide,
  type CareInput,
  type DiaperKind,
  FEEDING_DEFAULTS,
  type FeedingInput,
  type SaveRecordRequest,
  type SmartDefaults,
  type SolidFoodPreset,
  type StoolColor,
  type StoolConsistency,
} from '@/lib/records';

/** 后端一致的未来时间容忍偏移（5 分钟），避免轻微时钟偏差误伤正常录入。 */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** 后端一致的备注最大字符数（按 Unicode 码点计数）。 */
const MAX_NOTE_LENGTH = 500;

/** 喂养数值边界与步进配置（milkMin < milkStepMin 用于保证手输小奶量时步进控件单调不反向）。 */
export const FEEDING_BOUNDS = {
  milkMin: 1,
  milkStepMin: 10,
  milkMax: 1000,
  milkStep: 10,
  milkDefault: FEEDING_DEFAULTS.milkML,
  breastMin: 1,
  breastMax: 180,
  breastStep: 5,
  breastDefault: FEEDING_DEFAULTS.breastMin,
} as const;

/** 快捷录入与批量补录共享的亲喂常用时长快捷胶囊（分钟）。 */
export const BREAST_DURATION_PRESETS = [10, 15, 20, 30] as const;

const MILK_FREQUENT_FALLBACKS = [60, 90, 120] as const;
const SOLID_FOOD_FALLBACKS: readonly SolidFoodPreset[] = [
  { food: '高铁米粉', amount: '' },
  { food: '南瓜泥', amount: '' },
  { food: '苹果泥', amount: '' },
  { food: '蛋黄', amount: '' },
  { food: '蔬菜粥', amount: '' },
];

/** 各品类日常记录与生长发育录入 codec 共享的表单校验及提交载荷构建结果。 */
export type CategoryBuildResult =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly request: SaveRecordRequest;
      readonly toastTitle: string;
      readonly toastDescription?: string;
    };

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

/** 统一裁剪并校验日常记录备注长度（对齐后端 MaxNoteLength = 500 Unicode 字符）。 */
export function validateRecordNote(
  rawNote: string,
): { readonly ok: true; readonly note: string } | { readonly ok: false; readonly error: string } {
  const note = rawNote.trim();
  if (Array.from(note).length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `备注最多 ${MAX_NOTE_LENGTH} 个字` };
  }
  return { ok: true, note };
}

/** 校验 ISO 时间戳未超过当前时刻 5 分钟容忍偏移，与后端未来时钟偏移门禁保持一致。 */
export function validateNotFutureTimestamp(
  iso: string,
  now: Date = new Date(),
  errorMessage = '记录时间不能晚于当前时间',
): string | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    return '请选择有效的记录日期与时间';
  }
  if (ms > now.getTime() + MAX_FUTURE_SKEW_MS) {
    return errorMessage;
  }
  return null;
}

/** 校验奶量输入并构建配方奶或瓶喂母乳提交载荷。 */
export function buildMilkFeedingInput(params: {
  readonly kind: 'formula' | 'bottle_breast';
  readonly amountText: string;
  readonly recordedAt: string;
  readonly note: string;
  readonly errorMessage?: string;
}):
  | { readonly ok: true; readonly amountML: number; readonly payload: FeedingInput }
  | { readonly ok: false; readonly error: string } {
  const parsedML = parseStrictInt(params.amountText);
  if (parsedML === null || parsedML < FEEDING_BOUNDS.milkMin || parsedML > FEEDING_BOUNDS.milkMax) {
    return {
      ok: false,
      error: params.errorMessage ?? `请输入 ${FEEDING_BOUNDS.milkMin} 至 ${FEEDING_BOUNDS.milkMax} ml 之间的有效奶量`,
    };
  }
  const payload: FeedingInput =
    params.kind === 'formula'
      ? {
          subtype: 'formula',
          amount_ml: parsedML,
          recorded_at: params.recordedAt,
          note: params.note,
        }
      : {
          subtype: 'breast',
          feeding_mode: 'bottle',
          amount_ml: parsedML,
          recorded_at: params.recordedAt,
          note: params.note,
        };
  return { ok: true, amountML: parsedML, payload };
}

/** 校验亲喂时长并构建亲喂提交载荷。 */
export function buildDirectBreastInput(params: {
  readonly side: BreastSide;
  readonly durationText: string;
  readonly recordedAt: string;
  readonly note: string;
  readonly errorMessage?: string;
}):
  | { readonly ok: true; readonly durationMin: number; readonly payload: FeedingInput }
  | { readonly ok: false; readonly error: string } {
  const parsedMin = parseStrictInt(params.durationText);
  if (parsedMin === null || parsedMin < FEEDING_BOUNDS.breastMin || parsedMin > FEEDING_BOUNDS.breastMax) {
    return {
      ok: false,
      error:
        params.errorMessage ??
        `请输入 ${FEEDING_BOUNDS.breastMin} 至 ${FEEDING_BOUNDS.breastMax} 分钟之间的有效亲喂时长`,
    };
  }
  return {
    ok: true,
    durationMin: parsedMin,
    payload: {
      subtype: 'breast',
      feeding_mode: 'direct',
      breast_side: params.side,
      duration_min: parsedMin,
      recorded_at: params.recordedAt,
      note: params.note,
    },
  };
}

/** 组装换尿布护理载荷（仅嘘嘘时强制清空隐藏的大便性状与颜色字段置 null）。 */
export function buildDiaperCareInput(params: {
  readonly diaperKind: DiaperKind;
  readonly stoolConsistency: StoolConsistency | '';
  readonly stoolColor: StoolColor | '';
  readonly recordedAt: string;
  readonly note: string;
}): CareInput {
  const hasPoop = params.diaperKind === 'poop' || params.diaperKind === 'both';
  return {
    subtype: 'diaper',
    diaper_kind: params.diaperKind,
    stool_consistency: hasPoop ? params.stoolConsistency || null : null,
    stool_color: hasPoop ? params.stoolColor || null : null,
    recorded_at: params.recordedAt,
    note: params.note,
  };
}
