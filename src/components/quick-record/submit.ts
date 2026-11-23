import type { CareFormState } from '@/components/quick-record/care-fields';
import type { FeedingFormState } from '@/components/quick-record/feeding-fields';
import type { HealthFormState } from '@/components/quick-record/health-fields';
import type { SleepFormState } from '@/components/quick-record/sleep-fields';
import type { RecordCategory } from '@/lib/categories';
import {
  createCareRecord,
  createFeedingRecord,
  createHealthRecord,
  createSleepRecord,
  type EditableRecord,
  updateCareRecord,
  updateFeedingRecord,
  updateHealthRecord,
  updateSleepRecord,
} from '@/lib/records';
import { combineLocalDateTimeToISO, formatDurationMin } from '@/lib/time';

export interface QuickRecordSubmitInput {
  readonly category: RecordCategory;
  readonly isEdit: boolean;
  readonly editing: EditableRecord | null;
  readonly dateStr: string;
  readonly timeStr: string;
  readonly note: string;
  readonly feeding: FeedingFormState;
  readonly sleep: SleepFormState;
  readonly sleepPreviewMin: number;
  readonly care: CareFormState;
  readonly health: HealthFormState;
}

export type QuickRecordSubmitResult =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly toastTitle: string; readonly toastDescription?: string };

/** 严格解析正整数字符串，拒绝空值、小数与带尾随非数字字符的输入。 */
function parseStrictInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : null;
}

/** 严格解析有限实数字符串，空字符串返回 null，非法格式返回 'invalid'。 */
function parseOptionalStrictNumber(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : 'invalid';
}

/**
 * 统一执行快捷录入抽屉的前端校验、载荷组装与后端持久化，
 * 校验上下限与后端 `backend/internal/records/validate.go` 保持一致。
 */
export async function submitQuickRecord(input: QuickRecordSubmitInput): Promise<QuickRecordSubmitResult> {
  const { category, isEdit, editing, dateStr, timeStr, note, feeding, sleep, sleepPreviewMin, care, health } = input;

  if (category === 'feeding') {
    const recordedAt = combineLocalDateTimeToISO(dateStr, timeStr);
    if (!recordedAt) {
      return { ok: false, error: '请选择有效的喂养日期与时间' };
    }
    const parsedML = parseStrictInt(feeding.amountMLText);
    const parsedMin = parseStrictInt(feeding.breastMinText);

    if (
      (feeding.subtype === 'formula' || (feeding.subtype === 'breast' && feeding.feedingMode === 'bottle')) &&
      (parsedML === null || parsedML < 1 || parsedML > 1000)
    ) {
      return { ok: false, error: '请输入 1 至 1000 ml 之间的有效奶量' };
    }
    if (
      feeding.subtype === 'breast' &&
      feeding.feedingMode === 'direct' &&
      (parsedMin === null || parsedMin < 1 || parsedMin > 180)
    ) {
      return { ok: false, error: '请输入 1 至 180 分钟之间的有效亲喂时长' };
    }
    if (feeding.subtype === 'solid' && !feeding.solidFood.trim()) {
      return { ok: false, error: '请填写辅食内容' };
    }

    const payload =
      feeding.subtype === 'formula'
        ? { subtype: 'formula' as const, amount_ml: parsedML, recorded_at: recordedAt, note }
        : feeding.subtype === 'breast'
          ? feeding.feedingMode === 'bottle'
            ? {
                subtype: 'breast' as const,
                feeding_mode: 'bottle' as const,
                amount_ml: parsedML,
                recorded_at: recordedAt,
                note,
              }
            : {
                subtype: 'breast' as const,
                feeding_mode: 'direct' as const,
                breast_side: feeding.breastSide,
                duration_min: parsedMin,
                recorded_at: recordedAt,
                note,
              }
          : {
              subtype: 'solid' as const,
              solid_food: feeding.solidFood.trim(),
              solid_amount: feeding.solidAmount.trim() || null,
              acceptance: feeding.acceptance || null,
              recorded_at: recordedAt,
              note,
            };

    if (isEdit && editing?.category === 'feeding') {
      await updateFeedingRecord(editing.record.id, payload);
      return { ok: true, toastTitle: '喂养记录已更新' };
    }
    await createFeedingRecord(payload);
    return { ok: true, toastTitle: '已记录一笔喂养' };
  }

  if (category === 'sleep') {
    const startedAt = combineLocalDateTimeToISO(sleep.startDate, sleep.startTime);
    const endedAt = combineLocalDateTimeToISO(sleep.endDate, sleep.endTime);
    if (!startedAt || !endedAt) {
      return { ok: false, error: '请选择有效的入睡与醒来时间' };
    }
    if (sleepPreviewMin <= 0) {
      return { ok: false, error: '醒来时间必须晚于入睡时间' };
    }
    if (sleepPreviewMin > 24 * 60) {
      return { ok: false, error: '单次睡眠时长不能超过 24 小时' };
    }
    const payload = {
      subtype: sleep.subtype,
      started_at: startedAt,
      ended_at: endedAt,
      note,
    };
    if (isEdit && editing?.category === 'sleep') {
      await updateSleepRecord(editing.record.id, payload);
      return { ok: true, toastTitle: '睡眠记录已更新' };
    }
    await createSleepRecord(payload);
    return { ok: true, toastTitle: '已记录一笔睡眠', toastDescription: formatDurationMin(sleepPreviewMin) };
  }

  if (category === 'care') {
    const recordedAt = combineLocalDateTimeToISO(dateStr, timeStr);
    if (!recordedAt) {
      return { ok: false, error: '请选择有效的护理日期与时间' };
    }
    if (care.subtype === 'other' && !care.careTitle.trim()) {
      return { ok: false, error: '请填写护理内容' };
    }
    const payload =
      care.subtype === 'diaper'
        ? {
            subtype: 'diaper' as const,
            diaper_kind: care.diaperKind,
            stool_consistency: care.diaperKind === 'pee' ? null : care.stoolConsistency || null,
            stool_color: care.diaperKind === 'pee' ? null : care.stoolColor || null,
            recorded_at: recordedAt,
            note,
          }
        : care.subtype === 'bath'
          ? { subtype: 'bath' as const, recorded_at: recordedAt, note }
          : { subtype: 'other' as const, care_title: care.careTitle.trim(), recorded_at: recordedAt, note };

    if (isEdit && editing?.category === 'care') {
      await updateCareRecord(editing.record.id, payload);
      return { ok: true, toastTitle: '护理记录已更新' };
    }
    await createCareRecord(payload);
    return { ok: true, toastTitle: '已记录一笔护理' };
  }

  // category === 'health'
  const recordedAt = combineLocalDateTimeToISO(dateStr, timeStr);
  if (!recordedAt) {
    return { ok: false, error: '请选择有效的记录日期与时间' };
  }

  const parsedTemp = parseOptionalStrictNumber(health.temperatureText);
  if (
    health.subtype === 'temperature' &&
    (parsedTemp === null || parsedTemp === 'invalid' || parsedTemp < 34 || parsedTemp > 43)
  ) {
    return { ok: false, error: '请输入 34.0 至 43.0 ℃ 之间的有效体温' };
  }
  if (health.subtype === 'medicine' && !health.medicineName.trim()) {
    return { ok: false, error: '请填写药品或营养剂名称' };
  }
  if (health.subtype === 'teeth' && !health.toothNote.trim()) {
    return { ok: false, error: '请填写萌出牙位或说明' };
  }

  const parsedWeight = parseOptionalStrictNumber(health.weightKg);
  const parsedHeight = parseOptionalStrictNumber(health.heightCm);
  const parsedHead = parseOptionalStrictNumber(health.headCm);

  if (health.subtype === 'growth') {
    if (parsedWeight === 'invalid' || (parsedWeight !== null && (parsedWeight < 0.3 || parsedWeight > 40))) {
      return { ok: false, error: '体重应在 0.3 至 40.0 kg 之间' };
    }
    if (parsedHeight === 'invalid' || (parsedHeight !== null && (parsedHeight < 20 || parsedHeight > 150))) {
      return { ok: false, error: '身高应在 20.0 至 150.0 cm 之间' };
    }
    if (parsedHead === 'invalid' || (parsedHead !== null && (parsedHead < 20 || parsedHead > 70))) {
      return { ok: false, error: '头围应在 20.0 至 70.0 cm 之间' };
    }
    if (parsedWeight === null && parsedHeight === null && parsedHead === null) {
      return { ok: false, error: '体重、身高、头围请至少填写一项' };
    }
  }

  const payload =
    health.subtype === 'temperature'
      ? {
          subtype: 'temperature' as const,
          temperature_c: parsedTemp === 'invalid' ? null : parsedTemp,
          recorded_at: recordedAt,
          note,
        }
      : health.subtype === 'medicine'
        ? {
            subtype: 'medicine' as const,
            medicine_name: health.medicineName.trim(),
            medicine_dosage: health.medicineDosage.trim() || null,
            recorded_at: recordedAt,
            note,
          }
        : health.subtype === 'growth'
          ? {
              subtype: 'growth' as const,
              weight_kg: parsedWeight === 'invalid' ? null : parsedWeight,
              height_cm: parsedHeight === 'invalid' ? null : parsedHeight,
              head_cm: parsedHead === 'invalid' ? null : parsedHead,
              recorded_at: recordedAt,
              note,
            }
          : { subtype: 'teeth' as const, tooth_note: health.toothNote.trim(), recorded_at: recordedAt, note };

  if (isEdit && editing?.category === 'health') {
    await updateHealthRecord(editing.record.id, payload);
    return { ok: true, toastTitle: '健康记录已更新' };
  }
  await createHealthRecord(payload);
  return { ok: true, toastTitle: '已记录一笔健康数据' };
}
