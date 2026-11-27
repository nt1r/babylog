import { AlertTriangle, ChevronDown, HeartPulse, SaveIcon, Syringe, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { DateTimeInputRow } from '@/components/date-time-input-row';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { EntityDrawer } from '@/components/entity-drawer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceCardButton, QuickChip } from '@/components/ui/choice-controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { ClinicInputField } from '@/components/vaccines/clinic-input-field';
import {
  applyDetailClinicChange,
  applyDetailStatusChange,
  createDoseDetailDraft,
  createEmptyDoseDetailDraft,
  type DoseDetailDraft,
  MAX_AGE_MONTHS,
  validateAndBuildDoseUpdate,
} from '@/components/vaccines/vaccine-codec';
import { VaccineKnowledgeSection } from '@/components/vaccines/vaccine-knowledge-section';
import { formatShortCnDate } from '@/lib/time';
import {
  formatDoseOrderLabel,
  getAlertBadgeMeta,
  getSameDaySiteSuggestion,
  getSuggestedManufacturers,
  useDeleteVaccineDoseMutation,
  useDeleteVaccineTemplateMutation,
  useUpdateVaccineDoseMutation,
  VACCINE_REACTION_PRESETS,
  VACCINE_SITE_PRESETS,
  type VaccineDose,
  type VaccineStatus,
} from '@/lib/vaccines';
import { useOverlayStore } from '@/stores/overlays';

interface VaccineDetailDrawerProps {
  readonly open: boolean;
  readonly dose: VaccineDose | null;
  readonly allDoses: readonly VaccineDose[];
  readonly birthDate: string;
  readonly today: string;
  readonly defaultClinicName: string;
  readonly recentClinics: readonly string[];
  readonly onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: VaccineStatus; label: string }> = [
  { value: 'pending', label: '待接种' },
  { value: 'scheduled', label: '已预约' },
  { value: 'completed', label: '已接种' },
];

/** 单剂疫苗详情抽屉：支持三态流转（待接种/已预约/已接种）、接种后快捷记体温及只读科普风险区。 */
export function VaccineDetailDrawer({
  open,
  dose,
  allDoses,
  birthDate,
  today,
  defaultClinicName,
  recentClinics,
  onOpenChange,
}: VaccineDetailDrawerProps) {
  const updateMutation = useUpdateVaccineDoseMutation();
  const deleteMutation = useDeleteVaccineDoseMutation();
  const deleteTemplateMutation = useDeleteVaccineTemplateMutation();
  const openHealthQuickCreate = useOverlayStore((state) => state.openQuickCreate);

  // 关闭动画期间保留上一个 dose 引用，防止抽屉滑出瞬间内容闪烁。
  const [renderedDose, setRenderedDose] = useState<VaccineDose | null>(dose);
  const [draft, setDraft] = useState<DoseDetailDraft>(createEmptyDoseDetailDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'dose' | 'template' | null>(null);

  // 仅在抽屉打开或切换不同剂次 ID 时重置表单，防止窗口重连触发后台 refetch 覆盖未保存编辑。
  const latestRef = useRef({ dose, allDoses, today, defaultClinicName, recentClinics });
  latestRef.current = { dose, allDoses, today, defaultClinicName, recentClinics };
  const doseId = dose?.id ?? null;

  useEffect(() => {
    const current = latestRef.current;
    if (!open || !current.dose) return;
    setRenderedDose(current.dose);
    setDraft(createDoseDetailDraft(current.dose, { allDoses: current.allDoses, today: current.today }));
    setFormError(null);
    setDeleteMode(null);
  }, [open, doseId]);

  function patchDraft(patch: Partial<DoseDetailDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleClinicChange(nextValue: string) {
    setDraft((prev) => applyDetailClinicChange(prev, nextValue, latestRef.current.defaultClinicName));
  }

  function handleStatusChange(nextStatus: VaccineStatus) {
    const current = latestRef.current;
    setFormError(null);
    setDraft((prev) =>
      applyDetailStatusChange(prev, nextStatus, renderedDose, {
        allDoses: current.allDoses,
        defaultClinicName: current.defaultClinicName,
        recentClinics: current.recentClinics,
      }),
    );
  }

  const busy = updateMutation.isPending || deleteMutation.isPending || deleteTemplateMutation.isPending;

  // 提交或删除进行中禁止关闭抽屉，避免异步失败错误写入已关闭容器而丢失反馈。
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renderedDose || busy) return;

    const result = validateAndBuildDoseUpdate(draft, renderedDose, { birthDate, today });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    setFormError(null);
    try {
      await updateMutation.mutateAsync({ id: renderedDose.id, input: result.input });
      toast.success(result.toastTitle);
      onOpenChange(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    }
  }

  async function handleConfirmDelete() {
    if (!renderedDose || !deleteMode || busy) return;
    try {
      if (deleteMode === 'template' && renderedDose.template_code) {
        await deleteTemplateMutation.mutateAsync(renderedDose.template_code);
        toast.success(`已将「${renderedDose.vaccine_name}」整套移出计划`);
      } else {
        await deleteMutation.mutateAsync(renderedDose.id);
        toast.success('已删除本剂，后续剂次序号已自动顺延');
      }
      setDeleteMode(null);
      onOpenChange(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

  const active = renderedDose;
  const badgeMeta = active ? getAlertBadgeMeta(active.alert_state) : null;
  const isOptionalTemplate = Boolean(active?.template_code && active.category === 'optional');
  const suggestedManufacturers = active ? getSuggestedManufacturers(active, allDoses) : [];
  const sameDaySite =
    active && draft.status === 'completed' && !active.route.includes('口服')
      ? getSameDaySiteSuggestion(active.id, draft.vaccinatedAt, allDoses)
      : { usedSites: [], recommendedSite: null };

  return (
    <>
      <EntityDrawer
        open={open}
        pending={busy}
        onOpenChange={handleOpenChange}
        title={active ? active.vaccine_name : '疫苗详情'}
        description={
          active
            ? `${active.age_label} · ${formatDoseOrderLabel(active)}${active.route ? ` · ${active.route}` : ''}`
            : undefined
        }
        icon={<Syringe className="size-4.5 text-health" strokeWidth={1.8} />}
        badge={active && badgeMeta ? <Badge variant={badgeMeta.variant}>{badgeMeta.label}</Badge> : undefined}
        footer={
          active ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              {active.deletable ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="px-2 text-destructive hover:bg-destructive-soft hover:text-destructive"
                    onClick={() => setDeleteMode('dose')}
                  >
                    <Trash2 className="size-3.5" />
                    删除本剂
                  </Button>
                  {isOptionalTemplate && active.total_doses > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="px-2 text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                      onClick={() => setDeleteMode('template')}
                    >
                      移出整套
                    </Button>
                  ) : null}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">国家免疫规划基础项</span>
              )}

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
                  取消
                </Button>
                <Button type="submit" form="vaccine-dose-form" disabled={busy}>
                  {updateMutation.isPending ? (
                    <Spinner className="size-4" aria-hidden="true" role="presentation" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  {updateMutation.isPending ? '保存中…' : '保存更改'}
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {active ? (
          <div className="flex flex-col gap-4">
            <VaccineKnowledgeSection dose={active} disabled={busy} />

            <form id="vaccine-dose-form" onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-foreground">接种状态</p>
                <div className="grid grid-cols-3 gap-2">
                  {STATUS_OPTIONS.map((opt) => (
                    <ChoiceCardButton
                      key={opt.value}
                      disabled={busy}
                      active={draft.status === opt.value}
                      onClick={() => handleStatusChange(opt.value)}
                    >
                      {opt.label}
                    </ChoiceCardButton>
                  ))}
                </div>
              </div>

              {formError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              {draft.status === 'pending' ? (
                <FieldGroup className="space-y-3">
                  {active.deletable ? (
                    <Field>
                      <FieldLabel htmlFor="vac-age-months">适龄月龄</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Input
                          id="vac-age-months"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_AGE_MONTHS}
                          value={draft.ageMonths}
                          className="w-28 tabular-nums"
                          onChange={(e) => patchDraft({ ageMonths: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">月龄（修改后自动更新默认推算日）</span>
                      </div>
                    </Field>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="vac-planned-date">预计日期</FieldLabel>
                    <div className="flex items-center gap-2">
                      <DatePicker
                        id="vac-planned-date"
                        value={draft.plannedDate || active.default_due_date}
                        ariaLabel="预计日期"
                        drawerTitle="预计接种日期"
                        onChange={(plannedDate) => patchDraft({ plannedDate })}
                      />
                      {draft.plannedDate ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => patchDraft({ plannedDate: '' })}
                        >
                          恢复默认
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      默认推算 {formatShortCnDate(active.default_due_date, today)}
                    </p>
                  </Field>
                </FieldGroup>
              ) : null}

              {draft.status === 'scheduled' ? (
                <FieldGroup className="space-y-3">
                  <DateTimeInputRow
                    dateId="vac-sched-date"
                    timeId="vac-sched-time"
                    dateLabel="预约日期"
                    timeLabel="预约时间（可选）"
                    dateAriaLabel="预约日期"
                    timeAriaLabel="预约时间（可选）"
                    timePlaceholder="可选"
                    timeClearable
                    dateValue={draft.scheduledDate}
                    timeValue={draft.scheduledTime}
                    onDateChange={(scheduledDate) => patchDraft({ scheduledDate })}
                    onTimeChange={(scheduledTime) => patchDraft({ scheduledTime })}
                  />

                  <ClinicInputField
                    id="vac-clinic"
                    label="接种地点 / 社区门诊"
                    value={draft.clinicName}
                    defaultClinicName={defaultClinicName}
                    recentClinics={recentClinics}
                    autoFilled={draft.clinicAutoFilled}
                    pinAsDefault={draft.pinAsDefault}
                    onPinAsDefaultChange={(pinAsDefault) => patchDraft({ pinAsDefault })}
                    onChange={handleClinicChange}
                  />
                </FieldGroup>
              ) : null}

              {draft.status === 'completed' ? (
                <FieldGroup className="space-y-3">
                  <Field>
                    <FieldLabel htmlFor="vac-completed-date">实际接种日期</FieldLabel>
                    <DatePicker
                      id="vac-completed-date"
                      min={birthDate}
                      max={today}
                      value={draft.vaccinatedAt}
                      ariaLabel="实际接种日期"
                      drawerTitle="实际接种日期"
                      onChange={(vaccinatedAt) => patchDraft({ vaccinatedAt })}
                    />
                  </Field>

                  <ClinicInputField
                    id="vac-done-clinic"
                    label="接种地点（可选）"
                    value={draft.clinicName}
                    defaultClinicName={defaultClinicName}
                    recentClinics={recentClinics}
                    autoFilled={draft.clinicAutoFilled}
                    pinAsDefault={draft.pinAsDefault}
                    onPinAsDefaultChange={(pinAsDefault) => patchDraft({ pinAsDefault })}
                    onChange={handleClinicChange}
                  />

                  <Field>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel htmlFor="vac-site">接种部位（可选）</FieldLabel>
                      {sameDaySite.usedSites.length > 0 ? (
                        <span className="text-xs text-primary">
                          同日已打 {sameDaySite.usedSites.join('、')}
                          {sameDaySite.recommendedSite ? ` · 建议 ${sameDaySite.recommendedSite}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      id="vac-site"
                      value={draft.site}
                      maxLength={32}
                      placeholder="如 左上臂 / 左大腿前外侧 / 口服"
                      onChange={(e) => patchDraft({ site: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {VACCINE_SITE_PRESETS.map((preset) => {
                        const isRecommended = !draft.site && sameDaySite.recommendedSite === preset;
                        return (
                          <QuickChip
                            key={preset}
                            variant="outline"
                            tone={isRecommended ? 'primary' : 'health'}
                            disabled={busy}
                            active={draft.site === preset}
                            onClick={() => patchDraft({ site: preset })}
                            className={isRecommended ? 'border-primary/60 text-primary' : undefined}
                          >
                            {preset}
                            {isRecommended ? ' · 建议' : ''}
                          </QuickChip>
                        );
                      })}
                    </div>
                  </Field>

                  <Collapsible
                    open={draft.detailsOpen}
                    onOpenChange={(detailsOpen) => patchDraft({ detailsOpen })}
                    className="rounded-xl border border-border/75 bg-muted/20 px-3 py-2.5"
                  >
                    <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-[13px] font-medium text-foreground">
                      <span className="flex min-w-0 items-center gap-2">
                        <span>补充绿本与反应记录</span>
                        <span className="truncate text-xs font-normal text-muted-foreground">
                          {draft.manufacturer || draft.batchNo || draft.reaction
                            ? [draft.manufacturer, draft.batchNo && `批号 ${draft.batchNo}`, draft.reaction]
                                .filter(Boolean)
                                .join(' · ')
                            : suggestedManufacturers.length > 0
                              ? '可快捷选曾用厂家 · 批号与反应（选填）'
                              : '厂家、批号、反应观察（选填）'}
                        </span>
                      </span>
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/collapsible-trigger:rotate-180" />
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor="vac-maker">疫苗品牌 / 厂家（可选）</FieldLabel>
                            <Input
                              id="vac-maker"
                              value={draft.manufacturer}
                              maxLength={60}
                              placeholder="对照绿本选填"
                              onChange={(e) => patchDraft({ manufacturer: e.target.value })}
                            />
                            {suggestedManufacturers.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {suggestedManufacturers.map((maker) => (
                                  <QuickChip
                                    key={maker}
                                    variant="outline"
                                    disabled={busy}
                                    active={draft.manufacturer === maker}
                                    onClick={() => patchDraft({ manufacturer: maker })}
                                  >
                                    {maker}
                                  </QuickChip>
                                ))}
                              </div>
                            ) : null}
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="vac-batch">疫苗批号（可选）</FieldLabel>
                            <Input
                              id="vac-batch"
                              value={draft.batchNo}
                              maxLength={60}
                              placeholder="对照绿本选填"
                              className="tabular-nums"
                              onChange={(e) => patchDraft({ batchNo: e.target.value })}
                            />
                          </Field>
                        </div>

                        <Field>
                          <FieldLabel htmlFor="vac-reaction">接种后反应观察（可选）</FieldLabel>
                          <Input
                            id="vac-reaction"
                            value={draft.reaction}
                            maxLength={200}
                            placeholder="如 无异常 / 低热 37.6℃"
                            onChange={(e) => patchDraft({ reaction: e.target.value })}
                          />
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {VACCINE_REACTION_PRESETS.map((preset) => (
                              <QuickChip
                                key={preset}
                                variant="outline"
                                disabled={busy}
                                active={draft.reaction === preset}
                                onClick={() => patchDraft({ reaction: preset })}
                              >
                                {preset}
                              </QuickChip>
                            ))}
                          </div>
                        </Field>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* 接种后与既有「健康记录」体温快捷联动 */}
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-health/30 bg-health-soft/35 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-health-soft-foreground">
                      <HeartPulse className="size-4 shrink-0" />
                      <span>接种后 48 小时内若发热，可随时记一笔体温追踪</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => {
                        onOpenChange(false);
                        openHealthQuickCreate('health', 'temperature');
                      }}
                    >
                      去记体温
                    </Button>
                  </div>
                </FieldGroup>
              ) : null}

              <Field>
                <FieldLabel htmlFor="vac-note">备注（可选）</FieldLabel>
                <Input
                  id="vac-note"
                  value={draft.note}
                  maxLength={500}
                  placeholder="如 医生建议间隔时间、携带资料提醒等"
                  onChange={(e) => patchDraft({ note: e.target.value })}
                />
              </Field>
            </form>
          </div>
        ) : null}
      </EntityDrawer>

      <DeleteConfirmDialog
        open={deleteMode !== null}
        onOpenChange={(next) => {
          if (!next && (deleteMutation.isPending || deleteTemplateMutation.isPending)) return;
          if (!next) setDeleteMode(null);
        }}
        title={deleteMode === 'template' ? '确认整套移出该自费疫苗？' : '确认删除本剂疫苗？'}
        description={
          active
            ? deleteMode === 'template'
              ? `将把「${active.vaccine_name}」全部 ${active.total_doses} 剂从计划中移出（含已填记录），移出后可随时在「添加疫苗」重新加入。`
              : `将删除「${active.vaccine_name}（${formatDoseOrderLabel(active)}）」，同疫苗后续剂次序号将自动依次前移补齐。`
            : ''
        }
        confirmLabel={deleteMode === 'template' ? '确认移出整套' : '确认删除'}
        pending={deleteMutation.isPending || deleteTemplateMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
