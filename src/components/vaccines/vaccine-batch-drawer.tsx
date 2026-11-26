import { CalendarCheck2, CheckCheck } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { DateTimeInputRow } from '@/components/date-time-input-row';
import { EntityDrawer } from '@/components/entity-drawer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { ClinicInputField } from '@/components/vaccines/clinic-input-field';
import {
  applyBatchClinicChange,
  type BatchDoseDraft,
  type BatchDrawerIntent,
  createBatchDoseDraft,
  createEmptyBatchDoseDraft,
  validateAndBuildBatchUpdate,
} from '@/components/vaccines/vaccine-codec';
import { formatDoseShortTitle, useBatchVaccineMutation, type VaccineDose } from '@/lib/vaccines';

interface VaccineBatchDrawerProps {
  readonly open: boolean;
  readonly intent: BatchDrawerIntent | null;
  readonly allDoses: readonly VaccineDose[];
  readonly birthDate: string;
  readonly today: string;
  readonly defaultClinicName: string;
  readonly recentClinics: readonly string[];
  readonly onOpenChange: (open: boolean) => void;
}

/** 同月龄批量操作抽屉：支持多剂合并预约或历史已接种快速补录。 */
export function VaccineBatchDrawer({
  open,
  intent,
  allDoses,
  birthDate,
  today,
  defaultClinicName,
  recentClinics,
  onOpenChange,
}: VaccineBatchDrawerProps) {
  const batchMutation = useBatchVaccineMutation();
  // 关闭动画期间保留上一次意图，避免抽屉滑出瞬间标题与剂次列表闪烁。
  const [renderedIntent, setRenderedIntent] = useState<BatchDrawerIntent | null>(intent);
  const [draft, setDraft] = useState<BatchDoseDraft>(createEmptyBatchDoseDraft);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 通过单一快照 ref 读取最新常去/常用门诊、剂次与今天日期，避免抽屉打开期间后台刷新冲掉未保存表单。
  const latestRef = useRef({ allDoses, today, defaultClinicName, recentClinics });
  latestRef.current = { allDoses, today, defaultClinicName, recentClinics };

  useEffect(() => {
    if (!open || !intent) return;
    setRenderedIntent(intent);
    setDraft(createBatchDoseDraft(intent, latestRef.current));
    setErrorMsg(null);
  }, [open, intent]);

  function patchDraft(patch: Partial<BatchDoseDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  const active = renderedIntent;
  const targetDoses = active ? allDoses.filter((d) => active.doseIds.includes(d.id)) : [];

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && batchMutation.isPending) return;
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || batchMutation.isPending) return;

    const result = validateAndBuildBatchUpdate(draft, active, { birthDate, today });
    if (!result.ok) {
      setErrorMsg(result.error);
      return;
    }

    setErrorMsg(null);
    try {
      await batchMutation.mutateAsync(result.input);
      toast.success(result.toastTitle);
      onOpenChange(false);
    } catch (cause) {
      setErrorMsg(cause instanceof Error ? cause.message : '批量更新失败，请稍后重试');
    }
  }

  const isSchedule = active?.action === 'schedule';

  return (
    <EntityDrawer
      open={open}
      pending={batchMutation.isPending}
      onOpenChange={handleOpenChange}
      title={isSchedule ? `${active?.stageLabel ?? ''} · 登记预约` : `${active?.stageLabel ?? ''} · 标记已接种`}
      icon={
        isSchedule ? (
          <CalendarCheck2 className="size-4.5 text-primary" strokeWidth={1.8} />
        ) : (
          <CheckCheck className="size-4.5 text-success" strokeWidth={1.8} />
        )
      }
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={batchMutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button type="submit" form="vaccine-batch-form" disabled={batchMutation.isPending}>
            {batchMutation.isPending ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
            {batchMutation.isPending ? '保存中…' : isSchedule ? '保存预约' : '确认已接种'}
          </Button>
        </div>
      }
    >
      {active ? (
        <form id="vaccine-batch-form" onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">本次包含 {targetDoses.length} 剂疫苗</p>
            <div className="flex flex-wrap gap-1.5">
              {targetDoses.map((d) => (
                <Badge key={d.id} variant="secondary">
                  {formatDoseShortTitle(d)}
                </Badge>
              ))}
            </div>
          </div>

          {errorMsg ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup className="space-y-3.5">
            {isSchedule ? (
              <DateTimeInputRow
                dateId="batch-vac-date"
                timeId="batch-vac-time"
                dateLabel="预约日期"
                timeLabel="预约时间（可选）"
                dateAriaLabel="预约日期"
                timeAriaLabel="预约时间（可选）"
                timePlaceholder="可选"
                timeClearable
                dateValue={draft.date}
                timeValue={draft.time}
                onDateChange={(date) => patchDraft({ date })}
                onTimeChange={(time) => patchDraft({ time })}
              />
            ) : (
              <Field>
                <FieldLabel htmlFor="batch-vac-date">实际接种日期</FieldLabel>
                <DatePicker
                  id="batch-vac-date"
                  min={birthDate}
                  max={today}
                  value={draft.date}
                  ariaLabel="实际接种日期"
                  drawerTitle="实际接种日期"
                  onChange={(date) => patchDraft({ date })}
                />
              </Field>
            )}

            <ClinicInputField
              id="batch-vac-clinic"
              label="接种地点 / 门诊（可选）"
              value={draft.clinicName}
              defaultClinicName={defaultClinicName}
              recentClinics={recentClinics}
              autoFilled={draft.clinicAutoFilled}
              pinAsDefault={draft.pinAsDefault}
              onPinAsDefaultChange={(pinAsDefault) => patchDraft({ pinAsDefault })}
              onChange={(nextValue) =>
                setDraft((prev) => applyBatchClinicChange(prev, nextValue, latestRef.current.defaultClinicName))
              }
            />
            {draft.preserveExistingClinicsHint && !draft.clinicName.trim() ? (
              <p className="-mt-2 text-xs text-muted-foreground">部分剂次已记录接种地点，留空将保留各自原有地点。</p>
            ) : null}

            <Field>
              <FieldLabel htmlFor="batch-vac-note">备注（可选）</FieldLabel>
              <Input
                id="batch-vac-note"
                value={draft.note}
                maxLength={500}
                placeholder="如 同一天不同部位接种"
                onChange={(e) => patchDraft({ note: e.target.value })}
              />
            </Field>
          </FieldGroup>
        </form>
      ) : null}
    </EntityDrawer>
  );
}
