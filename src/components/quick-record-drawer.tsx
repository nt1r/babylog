import { format } from 'date-fns';
import { AlertCircle, Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import { CareFields } from '@/components/quick-record/care-fields';
import { resolveCarePresets } from '@/components/quick-record/codecs/care';
import {
  applySmartDefaultsToDraft,
  buildQuickRecordSubmission,
  createQuickRecordDraft,
  type QuickRecordDraft,
} from '@/components/quick-record/codecs/draft';
import { resolveFeedingPresets } from '@/components/quick-record/codecs/feeding';
import { resolveHealthPresets } from '@/components/quick-record/codecs/health';
import { computeSleepDurationMin } from '@/components/quick-record/codecs/sleep';
import { FeedingFields } from '@/components/quick-record/feeding-fields';
import { HealthFields } from '@/components/quick-record/health-fields';
import { SleepFields } from '@/components/quick-record/sleep-fields';
import { TimeOffsetPicker } from '@/components/quick-record/time-offset-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { RECORD_CATEGORIES, RECORD_CATEGORY_META } from '@/lib/categories';
import { useSaveRecordMutation, useSmartDefaultsQuery } from '@/lib/records';
import { cn } from '@/lib/utils';
import { useQuickRecordStore } from '@/stores/quick-record';

export function QuickRecordDrawer() {
  const open = useQuickRecordStore((state) => state.open);
  const intent = useQuickRecordStore((state) => state.intent);
  const setOpen = useQuickRecordStore((state) => state.setOpen);

  const defaultsQuery = useSmartDefaultsQuery(open);
  const defaults = defaultsQuery.data;
  const defaultsUpdatedAt = defaultsQuery.dataUpdatedAt;
  const defaultsFetching = defaultsQuery.isFetching;
  const saveMutation = useSaveRecordMutation();

  const [draft, setDraft] = useState<QuickRecordDraft>(() => createQuickRecordDraft(intent, undefined, new Date()));
  const [formError, setFormError] = useState('');

  const defaultsSnapRef = useRef({ defaults, updatedAt: defaultsUpdatedAt, isFetching: defaultsFetching });
  defaultsSnapRef.current = { defaults, updatedAt: defaultsUpdatedAt, isFetching: defaultsFetching };

  useEffect(() => {
    if (!open) return;
    setFormError('');
    const snap = defaultsSnapRef.current;
    // 若缓存正处于后台刷新（例如刚提交完记录立刻重开），不锁死 defaultsAppliedAt，
    // 以便最新 defaults 返回且用户尚未编辑字段时自动同步。
    const appliedAt = snap.defaults && !snap.isFetching && snap.updatedAt > 0 ? snap.updatedAt : null;
    setDraft(createQuickRecordDraft(intent, snap.defaults, new Date(), appliedAt));
  }, [open, intent]);

  // 异步到达的最新智能默认值通过纯函数守卫，仅在「新建态且用户尚未编辑任何字段」时回填。
  useEffect(() => {
    if (!open || !defaults || defaultsFetching || defaultsUpdatedAt <= 0) return;
    setDraft((prev) => applySmartDefaultsToDraft(prev, intent, defaults, defaultsUpdatedAt));
  }, [open, intent, defaults, defaultsFetching, defaultsUpdatedAt]);

  function updateDraft(updater: (prev: QuickRecordDraft) => QuickRecordDraft) {
    if (formError) setFormError('');
    setDraft((prev) => ({ ...updater(prev), userTouched: true }));
  }

  // 顶部 L1 分类切换不视为编辑表单字段，避免冷启动切换分类后阻断对应品类的默认值回填。
  function selectCategory(nextCategory: QuickRecordDraft['category']) {
    if (formError) setFormError('');
    setDraft((prev) => ({ ...prev, category: nextCategory }));
  }

  const isEdit = intent.mode === 'edit';
  const activeCategory = RECORD_CATEGORY_META[draft.category];
  const todayMaxDate = format(new Date(), 'yyyy-MM-dd');
  const sleepDurationMin = computeSleepDurationMin(draft.sleep);

  const feedingPresets = resolveFeedingPresets(defaults);
  const careOtherPresets = resolveCarePresets(defaults);
  const medicinePresets = resolveHealthPresets(defaults);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveMutation.isPending) return;

    setFormError('');
    const built = buildQuickRecordSubmission(draft, intent);
    if (!built.ok) {
      setFormError(built.error);
      return;
    }

    try {
      await saveMutation.mutateAsync(built.request);
      toast.success(built.toastTitle, built.toastDescription);
      setOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    }
  }

  const drawerTitle = isEdit
    ? `编辑${activeCategory.shortLabel}记录`
    : intent.mode === 'duplicate'
      ? `再记一笔${activeCategory.shortLabel}`
      : '快速记一笔';

  return (
    <EntityDrawer
      open={open}
      pending={saveMutation.isPending}
      onOpenChange={(next) => {
        if (!saveMutation.isPending) setOpen(next);
      }}
      title={drawerTitle}
      icon={<Sparkles className="size-4.5" />}
      footer={
        <div className="flex w-full flex-col gap-2.5">
          {formError ? (
            <Alert variant="destructive" size="compact" className="font-medium">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </Alert>
          ) : null}
          <div className="grid w-full grid-cols-[1fr_2fr] gap-2.5 sm:flex sm:w-auto sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={saveMutation.isPending}
              className="h-11 rounded-xl sm:h-10 sm:px-4"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="quick-record-form"
              disabled={saveMutation.isPending}
              className="h-11 rounded-xl sm:h-10 sm:px-5"
            >
              {saveMutation.isPending ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
              {saveMutation.isPending ? '保存中…' : isEdit ? '保存修改' : '保存记录'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="quick-record-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {!isEdit ? (
          <fieldset aria-label="记录分类" className="grid min-w-0 grid-cols-4 gap-1 border-0 p-0 sm:gap-1.5">
            {RECORD_CATEGORIES.map((categoryId) => {
              const item = RECORD_CATEGORY_META[categoryId];
              const Icon = item.icon;
              const selected = item.id === draft.category;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectCategory(item.id)}
                  className={cn(
                    'flex h-10 cursor-pointer items-center justify-center gap-1 rounded-xl border px-1.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-1.5 sm:px-2',
                    selected
                      ? item.activeClass
                      : 'border-border/75 bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                  <span>{item.shortLabel}</span>
                </button>
              );
            })}
          </fieldset>
        ) : null}

        {draft.category === 'feeding' ? (
          <FeedingFields
            state={draft.feeding}
            frequentMilk={feedingPresets.frequentMilk}
            solidPresets={feedingPresets.solidPresets}
            lastBreastSide={feedingPresets.lastBreastSide}
            suggestedBreastSide={feedingPresets.suggestedBreastSide}
            onChange={(patch) => updateDraft((prev) => ({ ...prev, feeding: { ...prev.feeding, ...patch } }))}
          />
        ) : null}

        {draft.category === 'sleep' ? (
          <SleepFields
            state={draft.sleep}
            maxDate={todayMaxDate}
            durationMin={sleepDurationMin}
            subtypeLocked={draft.sleepSubtypeLocked}
            onSubtypeSelect={(subtype) =>
              updateDraft((prev) => ({
                ...prev,
                sleepSubtypeLocked: true,
                sleep: { ...prev.sleep, subtype },
              }))
            }
            onChange={(patch) => updateDraft((prev) => ({ ...prev, sleep: { ...prev.sleep, ...patch } }))}
          />
        ) : null}

        {draft.category === 'care' ? (
          <CareFields
            state={draft.care}
            otherPresets={careOtherPresets}
            onChange={(patch) => updateDraft((prev) => ({ ...prev, care: { ...prev.care, ...patch } }))}
          />
        ) : null}

        {draft.category === 'health' ? (
          <HealthFields
            state={draft.health}
            medicinePresets={medicinePresets}
            onChange={(patch) => updateDraft((prev) => ({ ...prev, health: { ...prev.health, ...patch } }))}
          />
        ) : null}

        {/* 核心业务字段优先展示在首屏；睡眠自带起止时间区间，其余三类在下方统一提供记录时间与快捷偏移。 */}
        {draft.category !== 'sleep' ? (
          <TimeOffsetPicker
            dateStr={draft.dateStr}
            timeStr={draft.timeStr}
            maxDate={todayMaxDate}
            onChange={(dateStr, timeStr) => updateDraft((prev) => ({ ...prev, dateStr, timeStr }))}
          />
        ) : null}

        <Field>
          <FieldLabel htmlFor="quick-record-note">备注（可选）</FieldLabel>
          <Input
            id="quick-record-note"
            value={draft.note}
            maxLength={500}
            onChange={(event) => updateDraft((prev) => ({ ...prev, note: event.target.value }))}
            placeholder="记录宝宝的精神状态、吐奶情况或小变化…"
          />
        </Field>
      </form>
    </EntityDrawer>
  );
}
