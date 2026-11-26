import { subDays } from 'date-fns';
import { AlertCircle, Check, ClipboardList } from 'lucide-react';
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type BatchRecordDraft,
  type BatchSessionEntry,
  buildBatchPreview,
  buildRelativeTimeChips,
  createInitialBatchDraft,
  resetBatchDraftForContinue,
  resolveLastSessionBreastSide,
  resolveSessionSuggestedBreastSide,
  validateAndBuildBatchSubmission,
} from '@/components/batch-record/batch-codec';
import { BatchFeedingSection } from '@/components/batch-record/batch-feeding-section';
import { BatchSessionStrip } from '@/components/batch-record/batch-session-strip';
import { BatchTimeSection } from '@/components/batch-record/batch-time-section';
import { EntityDrawer } from '@/components/entity-drawer';
import { FEEDING_BOUNDS, resolveFeedingPresets } from '@/components/quick-record/codecs/feeding';
import { StoolObservationPanel } from '@/components/quick-record/stool-observation-panel';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceCardButton } from '@/components/ui/choice-controls';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useActiveBaby } from '@/lib/baby';
import {
  type BatchUndoTarget,
  type BreastSide,
  useBatchCreateRecordsMutation,
  useSmartDefaultsQuery,
  useUndoBatchRecordsMutation,
} from '@/lib/records';
import { formatLocalDateKey, formatShortCnDate } from '@/lib/time';
import { useBatchRecordStore } from '@/stores/batch-record';

function hasNestedOverlayOpen(): boolean {
  if (
    document.querySelector(
      '[data-slot="popover-content"], [data-slot="dialog-content"], [data-slot="alert-dialog-content"]',
    )
  ) {
    return true;
  }
  return document.querySelectorAll('[data-slot="drawer-popup"]').length > 1;
}

/**
 * 喂养与护理批量补录抽屉：
 * 面向对照月嫂纸质本按时间点连续录入场景，编排日期时间、喂养、排尿排便（自动合并 both）与会话撤销子模块；
 * 配备同步防重入提交/撤销锁与派生会话状态，确保快速连点不重提且撤销后换侧/跳时建议即时回退。
 */
export function BatchRecordDrawer() {
  const open = useBatchRecordStore((state) => state.open);
  const setOpen = useBatchRecordStore((state) => state.setOpen);
  const { babies, activeBaby, activeBabyId } = useActiveBaby();

  const defaultsQuery = useSmartDefaultsQuery(open);
  const batchMutation = useBatchCreateRecordsMutation();
  const undoMutation = useUndoBatchRecordsMutation();

  const [now, setNow] = useState(() => new Date());
  const [draft, setDraft] = useState<BatchRecordDraft>(() => createInitialBatchDraft());
  const [formError, setFormError] = useState('');
  const [sessionEntries, setSessionEntries] = useState<BatchSessionEntry[]>([]);
  const [sessionLogOpen, setSessionLogOpen] = useState(false);
  const [submitMode, setSubmitMode] = useState<'continue' | 'close'>('continue');
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const topAnchorRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const undoLockRef = useRef(false);
  const prevBabyIdRef = useRef<number | null>(activeBabyId);

  const defaultsRef = useRef(defaultsQuery.data);
  useLayoutEffect(() => {
    defaultsRef.current = defaultsQuery.data;
  }, [defaultsQuery.data]);

  // 每次打开抽屉开启全新补录会话并校准本地时钟，打开期间每分钟刷新一次以保持相对跳时胶囊准确。
  useEffect(() => {
    if (!open) return;
    const current = new Date();
    setNow(current);
    setDraft(createInitialBatchDraft(current));
    setFormError('');
    setSessionEntries([]);
    setSessionLogOpen(false);
    setUndoingId(null);
    submitLockRef.current = false;
    undoLockRef.current = false;

    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [open]);

  // 切换当前宝宝时关闭抽屉并清空会话，防止跨宝宝补录或误撤销。
  useEffect(() => {
    if (prevBabyIdRef.current !== activeBabyId) {
      prevBabyIdRef.current = activeBabyId;
      if (open) setOpen(false);
      setSessionEntries([]);
    }
  }, [activeBabyId, open, setOpen]);

  const todayMaxDate = formatLocalDateKey(now);
  const yesterdayDate = formatLocalDateKey(subDays(now, 1));
  const feedingPresets = resolveFeedingPresets(defaultsQuery.data);
  const defaultBreastMin = defaultsQuery.data?.feeding.last_breast_duration_min ?? FEEDING_BOUNDS.breastDefault;

  // 上次提交时间与会话亲喂侧别直接由 sessionEntries 派生，撤销时自动回退且消除冗余镜像状态。
  const lastSubmitted = sessionEntries[0] ?? null;
  const lastSessionBreastSide = useMemo(() => resolveLastSessionBreastSide(sessionEntries), [sessionEntries]);
  const suggestedBreastSide = resolveSessionSuggestedBreastSide(
    lastSessionBreastSide,
    feedingPresets.suggestedBreastSide,
  );

  const preview = useMemo(() => buildBatchPreview(draft), [draft]);
  const relativeTimeChips = useMemo(
    () => (lastSubmitted ? buildRelativeTimeChips(lastSubmitted.dateStr, lastSubmitted.timeStr, now) : []),
    [lastSubmitted, now],
  );
  const isDuplicateSessionTime = useMemo(
    () =>
      Boolean(
        draft.dateStr &&
          draft.timeStr &&
          sessionEntries.some((entry) => entry.dateStr === draft.dateStr && entry.timeStr === draft.timeStr),
      ),
    [draft.dateStr, draft.timeStr, sessionEntries],
  );

  const isBusy = batchMutation.isPending || undoingId !== null;

  function updateDraft(updater: (prev: BatchRecordDraft) => BatchRecordDraft) {
    if (formError) setFormError('');
    setDraft(updater);
  }

  function handleToggleBreastSide(side: BreastSide) {
    updateDraft((prev) => {
      if (prev.directBreastSide === side) {
        return { ...prev, directBreastSide: '', directBreastMinText: '' };
      }
      const fallbackMin = String(defaultsRef.current?.feeding.last_breast_duration_min ?? FEEDING_BOUNDS.breastDefault);
      return {
        ...prev,
        directBreastSide: side,
        directBreastMinText: prev.directBreastMinText.trim() ? prev.directBreastMinText : fallbackMin,
      };
    });
  }

  function handleTogglePoop() {
    updateDraft((prev) => {
      const nextPoop = !prev.hasPoop;
      // 取消勾选排便时同步清空便便观察状态，避免再次勾选残留旧选项。
      return nextPoop ? { ...prev, hasPoop: true } : { ...prev, hasPoop: false, stoolConsistency: '', stoolColor: '' };
    });
  }

  async function submitBatch(mode: 'continue' | 'close') {
    // 同步防重入锁：拦截 React 重渲染前的高频连点或连按快捷键，防止并发发出两次批量写入。
    if (submitLockRef.current || undoLockRef.current || isBusy) return;

    const currentNow = new Date();
    setNow(currentNow);
    setFormError('');

    const built = validateAndBuildBatchSubmission(draft, currentNow);
    if (!built.ok) {
      setFormError(built.error);
      return;
    }

    submitLockRef.current = true;
    setSubmitMode(mode);
    try {
      const saved = await batchMutation.mutateAsync(built.input);
      const targets: BatchUndoTarget[] = [
        ...saved.feedings.map((rec) => ({ category: 'feeding' as const, id: rec.id })),
        ...saved.cares.map((rec) => ({ category: 'care' as const, id: rec.id })),
      ];

      const shortDate = formatShortCnDate(draft.dateStr, formatLocalDateKey(currentNow));
      toast.success(`已补录 ${shortDate} ${draft.timeStr}（${targets.length} 条）`, built.summaryLabel);

      if (mode === 'close') {
        setOpen(false);
        return;
      }

      const entry: BatchSessionEntry = {
        id: `${draft.dateStr}-${draft.timeStr}-${Date.now()}`,
        dateStr: draft.dateStr,
        timeStr: draft.timeStr,
        summaryLabel: built.summaryLabel,
        usedBreastSide: built.usedBreastSide,
        targets,
      };
      setSessionEntries((prev) => [entry, ...prev]);
      setDraft(resetBatchDraftForContinue(draft.dateStr));
      window.requestAnimationFrame(() => {
        topAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '批量补录失败，请稍后重试');
    } finally {
      submitLockRef.current = false;
    }
  }

  const submitBatchRef = useRef(submitBatch);
  useLayoutEffect(() => {
    submitBatchRef.current = submitBatch;
  });

  // 抽屉打开期间监听 ⌘/Ctrl + Enter（覆盖表单与 Footer 焦点），跳过 IME 组合态与嵌套弹层。
  useEffect(() => {
    if (!open) return;
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (hasNestedOverlayOpen()) return;
        event.preventDefault();
        void submitBatchRef.current('continue');
      }
    }
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [open]);

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitBatch('continue');
  }

  async function handleUndoSessionEntry(entry: BatchSessionEntry) {
    if (undoLockRef.current || submitLockRef.current || isBusy) return;
    undoLockRef.current = true;
    setUndoingId(entry.id);
    setFormError('');

    try {
      const { remaining, firstError } = await undoMutation.mutateAsync(entry.targets);
      if (remaining.length === 0) {
        setSessionEntries((prev) => prev.filter((item) => item.id !== entry.id));
        toast.success('已撤销刚才的补录');
      } else {
        setSessionEntries((prev) =>
          prev.map((item) => (item.id === entry.id ? { ...item, targets: remaining } : item)),
        );
        toast.error(firstError || '部分记录撤销失败，可重试');
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '撤销失败，请稍后重试');
    } finally {
      undoLockRef.current = false;
      setUndoingId(null);
    }
  }

  return (
    <EntityDrawer
      open={open}
      pending={isBusy}
      onOpenChange={(next) => {
        if (!isBusy) setOpen(next);
      }}
      title="批量补录"
      description="同一时间一次记齐喂奶与嘘嘘便便，没发生的可留空"
      icon={<ClipboardList className="size-4.5" strokeWidth={1.8} />}
      badge={
        babies.length > 1 && activeBaby ? (
          <Badge variant="secondary" className="max-w-28 truncate font-normal">
            {activeBaby.nickname}
          </Badge>
        ) : undefined
      }
      className="md:max-w-lg"
      footer={
        <div className="flex w-full flex-col gap-2.5">
          {formError ? (
            <Alert variant="destructive" size="compact" className="font-medium">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </Alert>
          ) : null}

          <p className="text-xs leading-relaxed text-muted-foreground tabular-nums">
            {preview.count > 0 ? (
              <>
                <span className="font-medium text-foreground">本次将保存 {preview.count} 条：</span>
                {preview.parts.join(' · ')}
              </>
            ) : (
              '至少填一项喂奶，或选一项嘘嘘/便便'
            )}
          </p>

          <div className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="h-11 rounded-xl sm:h-10 sm:px-4"
              onClick={() => void submitBatch('close')}
            >
              {batchMutation.isPending && submitMode === 'close' ? (
                <Spinner className="size-4" aria-hidden="true" role="presentation" />
              ) : null}
              {batchMutation.isPending && submitMode === 'close' ? '保存中…' : '保存并关闭'}
            </Button>
            <Button
              type="submit"
              form="batch-record-form"
              disabled={isBusy}
              className="h-11 rounded-xl sm:h-10 sm:px-5"
            >
              {batchMutation.isPending && submitMode === 'continue' ? (
                <Spinner className="size-4" aria-hidden="true" role="presentation" />
              ) : null}
              {batchMutation.isPending && submitMode === 'continue' ? '保存中…' : '保存并继续'}
            </Button>
          </div>
        </div>
      }
    >
      <div ref={topAnchorRef} />

      <form id="batch-record-form" onSubmit={handleFormSubmit} noValidate className="flex flex-col gap-4">
        <BatchSessionStrip
          entries={sessionEntries}
          open={sessionLogOpen}
          todayMaxDate={todayMaxDate}
          isBusy={isBusy}
          undoingId={undoingId}
          onOpenChange={setSessionLogOpen}
          onUndo={(entry) => void handleUndoSessionEntry(entry)}
        />

        <BatchTimeSection
          dateStr={draft.dateStr}
          timeStr={draft.timeStr}
          todayMaxDate={todayMaxDate}
          yesterdayDate={yesterdayDate}
          lastSubmittedTimeStr={lastSubmitted?.timeStr ?? null}
          relativeTimeChips={relativeTimeChips}
          isDuplicateSessionTime={isDuplicateSessionTime}
          disabled={isBusy}
          onDateChange={(dateStr) => updateDraft((prev) => ({ ...prev, dateStr }))}
          onTimeChange={(timeStr) => updateDraft((prev) => ({ ...prev, timeStr }))}
          onDateTimeChange={(dateStr, timeStr) => updateDraft((prev) => ({ ...prev, dateStr, timeStr }))}
        />

        <BatchFeedingSection
          directBreastSide={draft.directBreastSide}
          directBreastMinText={draft.directBreastMinText}
          bottleBreastMLText={draft.bottleBreastMLText}
          formulaMLText={draft.formulaMLText}
          frequentMilk={feedingPresets.frequentMilk}
          defaultBreastMin={defaultBreastMin}
          suggestedBreastSide={suggestedBreastSide}
          disabled={isBusy}
          onToggleBreastSide={handleToggleBreastSide}
          onClearDirectBreast={() =>
            updateDraft((prev) => ({ ...prev, directBreastSide: '', directBreastMinText: '' }))
          }
          onDirectBreastMinChange={(directBreastMinText) => updateDraft((prev) => ({ ...prev, directBreastMinText }))}
          onBottleBreastChange={(bottleBreastMLText) => updateDraft((prev) => ({ ...prev, bottleBreastMLText }))}
          onFormulaChange={(formulaMLText) => updateDraft((prev) => ({ ...prev, formulaMLText }))}
        />

        {/* 嘘嘘与便便：独立勾选，双选自动合并为 1 条 both 尿布记录 */}
        <section aria-label="嘘嘘与便便" className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[13px] font-semibold text-foreground">嘘嘘与便便</span>
            <span className="text-xs text-muted-foreground">没换可不选</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <ChoiceCardButton
              tone="care"
              active={draft.hasPee}
              disabled={isBusy}
              onClick={() => updateDraft((prev) => ({ ...prev, hasPee: !prev.hasPee }))}
              className="h-11 gap-1.5"
            >
              {draft.hasPee ? <Check className="size-4 shrink-0" strokeWidth={2.2} aria-hidden="true" /> : null}
              <span>嘘嘘</span>
            </ChoiceCardButton>

            <ChoiceCardButton
              tone="care"
              active={draft.hasPoop}
              disabled={isBusy}
              onClick={handleTogglePoop}
              className="h-11 gap-1.5"
            >
              {draft.hasPoop ? <Check className="size-4 shrink-0" strokeWidth={2.2} aria-hidden="true" /> : null}
              <span>便便</span>
            </ChoiceCardButton>
          </div>

          {draft.hasPee && draft.hasPoop ? (
            <p className="rounded-xl bg-care-soft/55 px-3 py-1.5 text-xs text-care-soft-foreground">
              同时选了嘘嘘和便便，会合并记为 1 次「嘘嘘 + 便便」
            </p>
          ) : null}

          {draft.hasPoop ? (
            <StoolObservationPanel
              stoolConsistency={draft.stoolConsistency}
              stoolColor={draft.stoolColor}
              disabled={isBusy}
              className="rounded-2xl border-care/35 p-3.5"
              onChange={(patch) => updateDraft((prev) => ({ ...prev, ...patch }))}
            />
          ) : null}
        </section>

        <Field>
          <FieldLabel htmlFor="batch-record-note">备注（可选）</FieldLabel>
          <Input
            id="batch-record-note"
            value={draft.note}
            maxLength={500}
            disabled={isBusy}
            onChange={(event) => updateDraft((prev) => ({ ...prev, note: event.target.value }))}
            placeholder="会同步附带到本次每条记录，如拍嗝顺利、少量吐奶…"
          />
        </Field>
      </form>
    </EntityDrawer>
  );
}
