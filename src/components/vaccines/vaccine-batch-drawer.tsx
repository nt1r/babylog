import { CalendarCheck2, CheckCheck } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { ClinicInputField } from '@/components/vaccines/clinic-input-field';
import { formatDoseShortTitle, useBatchVaccineMutation, type VaccineDose } from '@/lib/vaccines';

export interface BatchDrawerIntent {
  readonly action: 'schedule' | 'complete';
  readonly stageLabel: string;
  readonly doseIds: number[];
  readonly defaultDate: string;
}

interface VaccineBatchDrawerProps {
  readonly open: boolean;
  readonly intent: BatchDrawerIntent | null;
  readonly allDoses: readonly VaccineDose[];
  readonly birthDate: string;
  readonly today: string;
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
  recentClinics,
  onOpenChange,
}: VaccineBatchDrawerProps) {
  const batchMutation = useBatchVaccineMutation();
  // 关闭动画期间保留上一次意图，避免抽屉滑出瞬间标题与剂次列表闪烁。
  const [renderedIntent, setRenderedIntent] = useState<BatchDrawerIntent | null>(intent);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 通过 ref 读取最新常用门诊与今天日期，避免抽屉打开期间后台刷新触发 effect 冲掉用户正在填写的表单。
  const recentClinicsRef = useRef(recentClinics);
  recentClinicsRef.current = recentClinics;
  const todayRef = useRef(today);
  todayRef.current = today;

  useEffect(() => {
    if (!open || !intent) return;
    const currentToday = todayRef.current;
    setRenderedIntent(intent);
    setDate(
      intent.action === 'complete' && intent.defaultDate > currentToday
        ? currentToday
        : intent.defaultDate || currentToday,
    );
    setTime('');
    setClinicName(recentClinicsRef.current[0] ?? '');
    setNote('');
    setErrorMsg(null);
  }, [open, intent]);

  const active = renderedIntent;
  const targetDoses = active ? allDoses.filter((d) => active.doseIds.includes(d.id)) : [];

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && batchMutation.isPending) return;
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || batchMutation.isPending) return;

    if (!date) {
      setErrorMsg(active.action === 'schedule' ? '请选择预约日期' : '请选择实际接种日期');
      return;
    }
    if (active.action === 'complete') {
      if (date > today) {
        setErrorMsg('实际接种日期不能晚于今天');
        return;
      }
      if (birthDate && date < birthDate) {
        setErrorMsg('实际接种日期不能早于宝宝出生日期');
        return;
      }
    }

    setErrorMsg(null);
    const trimmedClinic = clinicName.trim();
    const trimmedNote = note.trim();
    try {
      // 留空不传 clinic_name / note（undefined），遵守后端 *string 三态约定以保留目标剂次已有门诊与备注。
      await batchMutation.mutateAsync({
        action: active.action,
        dose_ids: active.doseIds,
        ...(active.action === 'schedule'
          ? { scheduled_date: date, scheduled_time: time.trim() || null }
          : { vaccinated_at: date }),
        ...(trimmedClinic ? { clinic_name: trimmedClinic } : {}),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      toast.success(
        active.action === 'schedule'
          ? `已合并预约 ${active.doseIds.length} 剂疫苗`
          : `已标记 ${active.doseIds.length} 剂疫苗为已接种`,
      );
      onOpenChange(false);
    } catch (cause) {
      setErrorMsg(cause instanceof Error ? cause.message : '批量更新失败，请稍后重试');
    }
  }

  const isSchedule = active?.action === 'schedule';

  return (
    <EntityDrawer
      open={open}
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
            <div className={isSchedule ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : ''}>
              <Field>
                <FieldLabel htmlFor="batch-vac-date">{isSchedule ? '预约日期' : '实际接种日期'}</FieldLabel>
                <Input
                  id="batch-vac-date"
                  type="date"
                  min={isSchedule ? undefined : birthDate}
                  max={isSchedule ? undefined : today}
                  value={date}
                  className="tabular-nums"
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>

              {isSchedule ? (
                <Field>
                  <FieldLabel htmlFor="batch-vac-time">预约时间（可选）</FieldLabel>
                  <Input
                    id="batch-vac-time"
                    type="time"
                    value={time}
                    className="tabular-nums"
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
              ) : null}
            </div>

            <ClinicInputField
              id="batch-vac-clinic"
              label="接种地点 / 门诊（可选）"
              value={clinicName}
              recentClinics={recentClinics}
              onChange={setClinicName}
            />

            <Field>
              <FieldLabel htmlFor="batch-vac-note">备注（可选）</FieldLabel>
              <Input
                id="batch-vac-note"
                value={note}
                maxLength={500}
                placeholder="如 同一天不同部位接种"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </FieldGroup>
        </form>
      ) : null}
    </EntityDrawer>
  );
}
