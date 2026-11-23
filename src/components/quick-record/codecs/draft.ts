import { parseISO } from 'date-fns';
import {
  type CareFormState,
  careFormFromRecord,
  createDefaultCareForm,
  validateAndBuildCareSubmission,
} from '@/components/quick-record/codecs/care';
import {
  createDefaultFeedingForm,
  type FeedingFormState,
  feedingFormFromRecord,
  validateAndBuildFeedingSubmission,
} from '@/components/quick-record/codecs/feeding';
import {
  createDefaultHealthForm,
  type HealthFormState,
  healthFormFromRecord,
  validateAndBuildHealthSubmission,
} from '@/components/quick-record/codecs/health';
import {
  createDefaultSleepForm,
  type SleepFormState,
  sleepFormFromRecord,
  validateAndBuildSleepSubmission,
} from '@/components/quick-record/codecs/sleep';
import type { CategoryBuildResult } from '@/components/quick-record/codecs/types';
import type { RecordCategory } from '@/lib/categories';
import type { SmartDefaults } from '@/lib/records';
import { splitLocalDateTime } from '@/lib/time';
import type { QuickRecordIntent } from '@/stores/quick-record';

export interface QuickRecordDraft {
  readonly category: RecordCategory;
  readonly dateStr: string;
  readonly timeStr: string;
  readonly note: string;
  readonly sleepSubtypeLocked: boolean;
  readonly feeding: FeedingFormState;
  readonly sleep: SleepFormState;
  readonly care: CareFormState;
  readonly health: HealthFormState;
  readonly userTouched: boolean;
  /** 已应用过的智能默认值版本号（对应 TanStack Query dataUpdatedAt；陈旧缓存尚在刷新时为 null）。 */
  readonly defaultsAppliedAt: number | null;
}

/**
 * 按打开意图（新建 / 编辑 / 再记一笔）构造完整的快捷录入草稿，
 * 将时间回填、品类初始值与睡眠子类型锁定规则收敛为纯函数。
 */
export function createQuickRecordDraft(
  intent: QuickRecordIntent,
  defaults: SmartDefaults | undefined,
  now: Date,
  defaultsAppliedAt: number | null = defaults ? 1 : null,
): QuickRecordDraft {
  const nowParts = splitLocalDateTime(now);
  const initialSubtype = intent.mode === 'create' ? intent.initialSubtype : undefined;

  const baseFeeding = createDefaultFeedingForm(
    intent.mode === 'create' && intent.category === 'feeding' ? initialSubtype : undefined,
    defaults,
  );
  const baseSleep = createDefaultSleepForm(
    now,
    intent.mode === 'create' && intent.category === 'sleep' ? initialSubtype : undefined,
  );
  const baseCare = createDefaultCareForm(
    intent.mode === 'create' && intent.category === 'care' ? initialSubtype : undefined,
  );
  const baseHealth = createDefaultHealthForm(
    intent.mode === 'create' && intent.category === 'health' ? initialSubtype : undefined,
    defaults,
  );

  if (intent.mode === 'create') {
    return {
      category: intent.category,
      dateStr: nowParts.date,
      timeStr: nowParts.time,
      note: '',
      sleepSubtypeLocked: intent.category === 'sleep' && (initialSubtype === 'nap' || initialSubtype === 'night'),
      feeding: baseFeeding,
      sleep: baseSleep,
      care: baseCare,
      health: baseHealth,
      userTouched: false,
      defaultsAppliedAt,
    };
  }

  const useOriginalTime = intent.mode === 'edit';
  const target = intent.target;

  if (target.category === 'feeding') {
    const dt = useOriginalTime ? splitLocalDateTime(parseISO(target.record.recorded_at)) : nowParts;
    return {
      category: 'feeding',
      dateStr: dt.date,
      timeStr: dt.time,
      note: target.record.note,
      sleepSubtypeLocked: false,
      feeding: feedingFormFromRecord(target.record, defaults),
      sleep: baseSleep,
      care: baseCare,
      health: baseHealth,
      userTouched: false,
      defaultsAppliedAt,
    };
  }

  if (target.category === 'sleep') {
    return {
      category: 'sleep',
      dateStr: nowParts.date,
      timeStr: nowParts.time,
      note: target.record.note,
      sleepSubtypeLocked: true,
      feeding: baseFeeding,
      sleep: sleepFormFromRecord(target.record, now, useOriginalTime),
      care: baseCare,
      health: baseHealth,
      userTouched: false,
      defaultsAppliedAt,
    };
  }

  if (target.category === 'care') {
    const dt = useOriginalTime ? splitLocalDateTime(parseISO(target.record.recorded_at)) : nowParts;
    return {
      category: 'care',
      dateStr: dt.date,
      timeStr: dt.time,
      note: target.record.note,
      sleepSubtypeLocked: false,
      feeding: baseFeeding,
      sleep: baseSleep,
      care: careFormFromRecord(target.record),
      health: baseHealth,
      userTouched: false,
      defaultsAppliedAt,
    };
  }

  const dt = useOriginalTime ? splitLocalDateTime(parseISO(target.record.recorded_at)) : nowParts;
  return {
    category: 'health',
    dateStr: dt.date,
    timeStr: dt.time,
    note: target.record.note,
    sleepSubtypeLocked: false,
    feeding: baseFeeding,
    sleep: baseSleep,
    care: baseCare,
    health: healthFormFromRecord(target.record, defaults),
    userTouched: false,
    defaultsAppliedAt,
  };
}

/**
 * 仅在「新建态 + 用户尚未编辑任何字段 + 当前版本默认值尚未应用」时回填智能默认值；
 * 当陈旧缓存正在后台刷新并在随后返回新版本 dataUpdatedAt 时可正常刷新，但绝不覆盖用户已编辑内容或编辑/复制态。
 */
export function applySmartDefaultsToDraft(
  draft: QuickRecordDraft,
  intent: QuickRecordIntent,
  defaults: SmartDefaults,
  defaultsUpdatedAt: number,
): QuickRecordDraft {
  if (intent.mode !== 'create' || draft.userTouched || draft.defaultsAppliedAt === defaultsUpdatedAt) {
    return draft;
  }
  return {
    ...draft,
    defaultsAppliedAt: defaultsUpdatedAt,
    feeding: createDefaultFeedingForm(intent.category === 'feeding' ? intent.initialSubtype : undefined, defaults),
    health: createDefaultHealthForm(intent.category === 'health' ? intent.initialSubtype : undefined, defaults),
  };
}

/** 对当前激活分类的草稿执行纯前端校验，并生成供外层 mutation 消费的保存请求与提示文案。 */
export function buildQuickRecordSubmission(draft: QuickRecordDraft, intent: QuickRecordIntent): CategoryBuildResult {
  const editId =
    intent.mode === 'edit' && intent.target.category === draft.category ? intent.target.record.id : undefined;

  if (draft.category === 'feeding') {
    return validateAndBuildFeedingSubmission(draft.feeding, {
      dateStr: draft.dateStr,
      timeStr: draft.timeStr,
      note: draft.note,
      editId,
    });
  }
  if (draft.category === 'sleep') {
    return validateAndBuildSleepSubmission(draft.sleep, {
      note: draft.note,
      editId,
    });
  }
  if (draft.category === 'care') {
    return validateAndBuildCareSubmission(draft.care, {
      dateStr: draft.dateStr,
      timeStr: draft.timeStr,
      note: draft.note,
      editId,
    });
  }
  return validateAndBuildHealthSubmission(draft.health, {
    dateStr: draft.dateStr,
    timeStr: draft.timeStr,
    note: draft.note,
    editId,
  });
}
