import { AlertCircle, Ruler } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import {
  buildDynamicTeethPresets,
  createGrowthFormState,
  type GrowthFormState,
  validateAndBuildGrowthSubmission,
} from '@/components/growth/growth-codec';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { QuickChip, SegmentedControl } from '@/components/ui/choice-controls';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { GROWTH_SUBTYPE_OPTIONS } from '@/lib/categories';
import { useGrowthSummaryQuery } from '@/lib/growth';
import { useSaveRecordMutation } from '@/lib/records';
import { formatLocalDateKey } from '@/lib/time';
import { useGrowthRecordStore } from '@/stores/growth-record';

/** 生长发育专属录入抽屉（体格测量 / 长牙），日期精度简化为按日选择。 */
export function GrowthRecordDrawer() {
  const open = useGrowthRecordStore((state) => state.open);
  const intent = useGrowthRecordStore((state) => state.intent);
  const setOpen = useGrowthRecordStore((state) => state.setOpen);

  const saveMutation = useSaveRecordMutation();
  // 复用生长非轮询概览选择器读取上次测量参考值与累计出牙数。
  const summaryQuery = useGrowthSummaryQuery(open);
  const growthSummary = summaryQuery.data?.growth;

  const [form, setForm] = useState<GrowthFormState>(() => createGrowthFormState(intent, new Date()));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setForm(createGrowthFormState(intent, new Date()));
  }, [open, intent]);

  function updateForm(patch: Partial<GrowthFormState>) {
    if (formError) setFormError('');
    setForm((prev) => ({ ...prev, ...patch }));
  }

  const isEdit = intent.mode === 'edit';
  const todayMaxDate = formatLocalDateKey(new Date());
  const teethCount = growthSummary?.teeth_count ?? 0;
  const teethPresets = buildDynamicTeethPresets(teethCount);
  const lastRefParts: string[] = [];
  if (growthSummary?.latest_weight_kg != null) {
    lastRefParts.push(`体重 ${growthSummary.latest_weight_kg} kg${growthSummary.weight_is_birth ? '（出生）' : ''}`);
  }
  if (growthSummary?.latest_height_cm != null) {
    lastRefParts.push(`身高 ${growthSummary.latest_height_cm} cm${growthSummary.height_is_birth ? '（出生）' : ''}`);
  }
  if (growthSummary?.latest_head_cm != null) {
    lastRefParts.push(`头围 ${growthSummary.latest_head_cm} cm`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveMutation.isPending) return;

    setFormError('');
    const built = validateAndBuildGrowthSubmission(form, intent, new Date());
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

  const drawerTitle = isEdit ? '编辑生长发育记录' : '记录生长发育';

  return (
    <EntityDrawer
      open={open}
      pending={saveMutation.isPending}
      onOpenChange={(next) => {
        if (!saveMutation.isPending) setOpen(next);
      }}
      title={drawerTitle}
      icon={<Ruler className="size-4.5" />}
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
              form="growth-record-form"
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
      <form id="growth-record-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <FieldGroup className="gap-4">
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">记录项目</p>
            <SegmentedControl
              ariaLabel="生长发育项目"
              options={GROWTH_SUBTYPE_OPTIONS}
              value={form.subtype}
              onChange={(subtype) => updateForm({ subtype })}
            />
          </div>

          {form.subtype === 'growth' ? (
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground">体重、身高、头围至少填写一项即可保存</p>
              {lastRefParts.length > 0 ? (
                <p className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground tabular-nums">
                  上次记录：{lastRefParts.join(' · ')}
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2.5">
                <Field>
                  <FieldLabel htmlFor="growth-drawer-weight">体重（kg）</FieldLabel>
                  <Input
                    id="growth-drawer-weight"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder={
                      growthSummary?.latest_weight_kg != null ? `上次 ${growthSummary.latest_weight_kg}` : '6.8'
                    }
                    className="tabular-nums"
                    value={form.weightKg}
                    onChange={(event) => updateForm({ weightKg: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="growth-drawer-height">身高（cm）</FieldLabel>
                  <Input
                    id="growth-drawer-height"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    placeholder={
                      growthSummary?.latest_height_cm != null ? `上次 ${growthSummary.latest_height_cm}` : '64.5'
                    }
                    className="tabular-nums"
                    value={form.heightCm}
                    onChange={(event) => updateForm({ heightCm: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="growth-drawer-head">头围（cm）</FieldLabel>
                  <Input
                    id="growth-drawer-head"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    placeholder={
                      growthSummary?.latest_head_cm != null ? `上次 ${growthSummary.latest_head_cm}` : '41.0'
                    }
                    className="tabular-nums"
                    value={form.headCm}
                    onChange={(event) => updateForm({ headCm: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          ) : (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="growth-drawer-teeth">萌出牙位 / 说明</FieldLabel>
                {teethCount > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">已记录 {teethCount} 颗</span>
                ) : null}
              </div>
              <Input
                id="growth-drawer-teeth"
                value={form.toothNote}
                placeholder={`例如：${teethPresets[0] ?? '下中切牙（第 1 颗）'}`}
                onChange={(event) => updateForm({ toothNote: event.target.value })}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {teethPresets.map((preset) => (
                  <QuickChip
                    key={preset}
                    tone="health"
                    active={form.toothNote === preset}
                    onClick={() => updateForm({ toothNote: preset })}
                  >
                    {preset}
                  </QuickChip>
                ))}
              </div>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="growth-drawer-date">测量 / 记录日期</FieldLabel>
            <DatePicker
              id="growth-drawer-date"
              value={form.dateStr}
              max={todayMaxDate}
              ariaLabel="测量或记录日期"
              drawerTitle="选择记录日期"
              onChange={(dateStr) => updateForm({ dateStr })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="growth-drawer-note">备注（可选）</FieldLabel>
            <Input
              id="growth-drawer-note"
              value={form.note}
              maxLength={500}
              onChange={(event) => updateForm({ note: event.target.value })}
              placeholder="例如：社区儿保 4 月龄体检、出牙轻微流口水…"
            />
          </Field>
        </FieldGroup>
      </form>
    </EntityDrawer>
  );
}
