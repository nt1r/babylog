import {
  ArrowRight,
  Baby,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  MapPin,
  PencilIcon,
  Pin,
  ShieldAlert,
  Syringe,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { QuickChip } from '@/components/ui/choice-controls';
import { DatePicker } from '@/components/ui/date-picker';
import { InfoPopover } from '@/components/ui/info-popover';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { VaccineCalendar } from '@/components/vaccines/vaccine-calendar';
import { type BirthConfirmItem, getDefaultBirthDoseDate } from '@/components/vaccines/vaccine-codec';
import { formatShortCnDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  formatDaysUntilLabel,
  formatDoseShortTitle,
  getAlertBadgeMeta,
  type VaccineDose,
  type VaccineOverviewResponse,
  type VaccineStatusFilter,
} from '@/lib/vaccines';

interface VaccineOverviewProps {
  readonly overview: VaccineOverviewResponse;
  readonly babyNickname?: string;
  readonly birthConfirmDismissed: boolean;
  readonly confirmingBirth: boolean;
  readonly savingDefaultClinic: boolean;
  readonly onConfirmBirthDoses: (items: readonly BirthConfirmItem[]) => void;
  readonly onDismissBirthConfirm: () => void;
  readonly onSaveDefaultClinic: (clinicName: string) => Promise<boolean>;
  readonly onOpenDose: (dose: VaccineDose) => void;
  readonly onOpenBatchScheduleFocus: (doseIds: number[], label: string, defaultDate: string) => void;
  readonly onOpenBatchCompleteFocus: (
    doseIds: number[],
    label: string,
    defaultDate: string,
    defaultClinic?: string,
  ) => void;
  readonly onSelectStatusFilter?: (filter: VaccineStatusFilter) => void;
}

/** 疫苗页首屏总览区：精简风险声明、产院疫苗确认，以及「直观接种日历 + 下次接种与进度」双栏视图。 */
export function VaccineOverview({
  overview,
  babyNickname,
  birthConfirmDismissed,
  confirmingBirth,
  savingDefaultClinic,
  onConfirmBirthDoses,
  onDismissBirthConfirm,
  onSaveDefaultClinic,
  onOpenDose,
  onOpenBatchScheduleFocus,
  onOpenBatchCompleteFocus,
  onSelectStatusFilter,
}: VaccineOverviewProps) {
  const { summary, doses, today } = overview;
  const focus = summary.next_focus;
  const [editingClinic, setEditingClinic] = useState(false);
  const [clinicDraft, setClinicDraft] = useState('');

  function startEditDefaultClinic() {
    setClinicDraft(overview.default_clinic_name);
    setEditingClinic(true);
  }

  async function handleSubmitDefaultClinic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingDefaultClinic) return;
    const ok = await onSaveDefaultClinic(clinicDraft.trim());
    if (ok) {
      setEditingClinic(false);
    }
  }
  const nipPercent = summary.nip_total > 0 ? Math.round((summary.nip_completed / summary.nip_total) * 100) : 0;
  const optionalPercent =
    summary.optional_total > 0 ? Math.round((summary.optional_completed / summary.optional_total) * 100) : 0;

  const focusDoses = focus ? doses.filter((d) => focus.dose_ids.includes(d.id)) : [];
  const leadFocusDose = focusDoses[0] ?? null;

  const pendingBirthDoses = doses.filter((d) => summary.birth_pending_dose_ids.includes(d.id));
  const pendingBirthKey = pendingBirthDoses.map((d) => d.id).join(',');

  // 为产院两针各自维护勾选态与默认日期（乙肝默认出生当天、卡介苗默认出生次日）。
  const [birthSelection, setBirthSelection] = useState<Record<number, { checked: boolean; date: string }>>({});
  const prevBirthDateRef = useRef(overview.birth_date);

  useEffect(() => {
    const birthDateChanged = prevBirthDateRef.current !== overview.birth_date;
    prevBirthDateRef.current = overview.birth_date;
    setBirthSelection((prev) => {
      const next: Record<number, { checked: boolean; date: string }> = {};
      for (const dose of pendingBirthDoses) {
        const defaultDate = getDefaultBirthDoseDate(dose, overview.birth_date, today);
        const existing = prev[dose.id];
        // 若用户在设置页修改了宝宝出生日期，保留勾选态但同步刷新默认日期，避免残留旧出生日期。
        next[dose.id] = existing
          ? { checked: existing.checked, date: birthDateChanged ? defaultDate : existing.date }
          : { checked: true, date: defaultDate };
      }
      return next;
    });
    // 仅在待确认剂次 ID 列表或出生日期变更时同步默认项，避免覆盖用户手调日期。
  }, [pendingBirthKey, overview.birth_date, today]);

  const selectedBirthItems: BirthConfirmItem[] = pendingBirthDoses
    .filter((d) => birthSelection[d.id]?.checked)
    .map((dose) => ({
      dose,
      vaccinatedAt: birthSelection[dose.id]?.date || overview.birth_date,
    }));

  return (
    <div className="flex flex-col gap-3.5">
      {/* 精简常驻风险提示条：保持免责声明可见，同时将完整声明与通用接种须知收敛至点击式帮助浮层 */}
      <div
        role="note"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/75 bg-muted/35 px-3.5 py-2 text-xs text-muted-foreground"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning-soft-foreground sm:mt-0" aria-hidden="true" />
          <span className="leading-relaxed">排期仅供参考，接种前请以纸质《预防接种证》及接种医生医嘱为准。</span>
        </div>
        <InfoPopover
          title="疫苗接种通用须知"
          label="接种须知"
          triggerVariant="pill"
          tone="warning"
          align="end"
          triggerClassName="h-6 px-2"
        >
          <div className="space-y-3">
            <p className="rounded-xl border border-warning/25 bg-warning-soft/55 px-3 py-2 text-warning-soft-foreground">
              {overview.disclaimer}
            </p>
            <div className="space-y-1">
              <p className="font-medium text-foreground">接种前准备</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>携带纸质《预防接种证》，给宝宝穿宽松易穿脱的衣物。</li>
                <li>发热、急性疾病或严重腹泻期应提前告知医生并遵医嘱暂缓。</li>
                <li>主动告知既往过敏史、上次接种反应及近期用药情况。</li>
              </ul>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">接种后观察</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>现场留观满 30 分钟无异常再离开，当日避免揉搓针眼或久泡。</li>
                <li>48 小时内留意精神、食欲与体温，持续高热或明显不适请及时就医。</li>
              </ul>
            </div>
          </div>
        </InfoPopover>
      </div>

      {/* 产院出生疫苗确认：单层紧凑内边距，自适应胶囊宽度避免宽屏出现大块空洞 */}
      {summary.birth_confirm_pending && !birthConfirmDismissed ? (
        <section
          aria-label="产院出生疫苗确认"
          className="flex flex-col gap-2.5 rounded-2xl border border-primary/30 bg-accent/35 px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Baby className="size-4" strokeWidth={1.8} />
              </span>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="text-sm font-semibold text-foreground">产院出生疫苗确认</p>
                <p className="text-xs text-muted-foreground">核对出院小结/接种证后勾选（早产或暂缓可取消勾选）</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                className="h-8"
                disabled={confirmingBirth || selectedBirthItems.length === 0}
                onClick={() => onConfirmBirthDoses(selectedBirthItems)}
              >
                {confirmingBirth ? (
                  <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                {confirmingBirth
                  ? '确认中…'
                  : selectedBirthItems.length > 0
                    ? `确认 ${selectedBirthItems.length} 剂已接种`
                    : '确认已接种'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2.5 text-muted-foreground"
                disabled={confirmingBirth}
                onClick={onDismissBirthConfirm}
              >
                稍后
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pendingBirthDoses.map((dose) => {
              const entry = birthSelection[dose.id] ?? {
                checked: true,
                date: getDefaultBirthDoseDate(dose, overview.birth_date, today),
              };
              const label = formatDoseShortTitle(dose);
              const defaultHint = dose.template_code === 'bcg' ? '次日' : '当天';
              const checkboxId = `birth-dose-${dose.id}`;
              return (
                <div
                  key={dose.id}
                  className={cn(
                    'flex w-full items-center justify-between gap-2.5 rounded-xl border px-2.5 py-1.5 transition-all sm:w-auto sm:justify-start',
                    entry.checked
                      ? 'border-border/80 bg-card shadow-2xs'
                      : 'border-dashed border-border/70 bg-card/45 opacity-65',
                  )}
                >
                  <label
                    htmlFor={checkboxId}
                    className="group flex min-w-0 cursor-pointer items-center gap-2 select-none"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={entry.checked}
                      disabled={confirmingBirth}
                      onCheckedChange={(checked) =>
                        setBirthSelection((prev) => ({
                          ...prev,
                          [dose.id]: { ...entry, checked },
                        }))
                      }
                      className="group-hover:border-primary/65"
                    />
                    <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
                    <span className="shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-xs text-muted-foreground">
                      {defaultHint}
                    </span>
                  </label>
                  <DatePicker
                    size="sm"
                    ariaLabel={`${label}实际接种日期`}
                    drawerTitle={`${label}接种日期`}
                    min={overview.birth_date}
                    max={today}
                    disabled={!entry.checked || confirmingBirth}
                    value={entry.date}
                    onChange={(nextDate) =>
                      setBirthSelection((prev) => ({
                        ...prev,
                        [dose.id]: { ...entry, date: nextDate },
                      }))
                    }
                    className="w-36 shrink-0 sm:w-[8.75rem]"
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 首屏双栏：左 3/5 直观接种日历（含统一导出入口），右 2/5 下次接种与进度合并卡 */}
      <div className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-5">
        <div className="@4xl/main:col-span-3">
          <VaccineCalendar
            doses={doses}
            today={today}
            defaultClinicName={overview.default_clinic_name}
            nextFocus={focus}
            babyNickname={babyNickname}
            onSelectDose={onOpenDose}
          />
        </div>

        <Card className="flex h-full flex-col justify-between @4xl/main:col-span-2">
          <div>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4 text-health" />
                下次接种
              </CardTitle>
              {focus ? (
                <Badge variant={getAlertBadgeMeta(focus.kind).variant}>{getAlertBadgeMeta(focus.kind).label}</Badge>
              ) : (
                <Badge variant="success">全部完成</Badge>
              )}
            </CardHeader>

            <CardContent className="space-y-3">
              {focus ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-xl font-semibold tracking-tight text-foreground tabular-nums">
                      {formatShortCnDate(focus.target_date, today)}
                      {focus.scheduled_time ? ` ${focus.scheduled_time}` : ''}
                    </span>
                    <span className="text-sm font-medium text-primary tabular-nums">
                      {formatDaysUntilLabel(
                        focus.days_until,
                        focus.kind.startsWith('scheduled') ? 'scheduled' : 'pending',
                      )}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {focus.age_label}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {focusDoses.map((dose) => (
                      <button
                        key={dose.id}
                        type="button"
                        onClick={() => onOpenDose(dose)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-3 py-1 text-[13px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
                      >
                        <Syringe className="size-3.5 text-health" />
                        <span>{formatDoseShortTitle(dose)}</span>
                      </button>
                    ))}
                  </div>

                  {focus.clinic_name ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0 text-primary" />
                      <span>{focus.clinic_name}</span>
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {focus.dose_ids.length > 1 && focus.kind.startsWith('scheduled') ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            onOpenBatchCompleteFocus(
                              focus.dose_ids,
                              `${focus.age_label}同期疫苗`,
                              focus.target_date <= today ? focus.target_date : today,
                              focus.clinic_name || undefined,
                            )
                          }
                        >
                          <CheckCheck className="size-3.5" />
                          一键已接种（{focus.dose_ids.length} 剂）
                        </Button>
                        {leadFocusDose ? (
                          <Button size="sm" variant="outline" onClick={() => onOpenDose(leadFocusDose)}>
                            查看详情
                          </Button>
                        ) : null}
                      </>
                    ) : focus.dose_ids.length > 1 && !focus.kind.startsWith('scheduled') ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          onOpenBatchScheduleFocus(focus.dose_ids, `${focus.age_label}同期疫苗`, focus.target_date)
                        }
                      >
                        合并预约
                      </Button>
                    ) : leadFocusDose ? (
                      <Button size="sm" onClick={() => onOpenDose(leadFocusDose)}>
                        {leadFocusDose.status === 'scheduled' ? '查看 / 打卡' : '登记 / 详情'}
                        <ArrowRight className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="text-sm text-success-soft-foreground">当前计划疫苗已全部接种完成。</p>
              )}
            </CardContent>
          </div>

          <CardContent className="space-y-3.5 pt-0">
            <Separator />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-foreground">免费规划进度</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {summary.nip_completed} / {summary.nip_total} 剂（{nipPercent}%）
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${nipPercent}%` }}
                />
              </div>
            </div>

            {summary.optional_total > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-foreground">自费 / 自选进度</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {summary.optional_completed} / {summary.optional_total} 剂（{optionalPercent}%）
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-health transition-all duration-300"
                    style={{ width: `${optionalPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-2">
              {(() => {
                const dueSoonTotal = summary.due_soon_count + summary.scheduled_soon_count;
                const overdueTotal = summary.overdue_count + summary.scheduled_overdue_count;
                return (
                  <>
                    <button
                      type="button"
                      disabled={summary.scheduled_count === 0}
                      onClick={() => onSelectStatusFilter?.('scheduled')}
                      aria-label={`筛选已预约疫苗（${summary.scheduled_count} 剂）`}
                      className="cursor-pointer rounded-xl border border-border/70 bg-muted/35 px-2 py-2 text-center transition-colors outline-none hover:border-info/50 hover:bg-info-soft/35 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-75 disabled:hover:border-border/70 disabled:hover:bg-muted/35"
                    >
                      <p className="text-base font-semibold text-info-soft-foreground tabular-nums">
                        {summary.scheduled_count}
                      </p>
                      <p className="text-xs text-muted-foreground">已预约</p>
                    </button>
                    <button
                      type="button"
                      disabled={dueSoonTotal === 0}
                      onClick={() => onSelectStatusFilter?.('attention')}
                      aria-label={`筛选待关注疫苗（含 ${dueSoonTotal} 剂近期）`}
                      className="cursor-pointer rounded-xl border border-border/70 bg-muted/35 px-2 py-2 text-center transition-colors outline-none hover:border-warning/55 hover:bg-warning-soft/35 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-75 disabled:hover:border-border/70 disabled:hover:bg-muted/35"
                    >
                      <p className="text-base font-semibold text-warning-soft-foreground tabular-nums">
                        {dueSoonTotal}
                      </p>
                      <p className="text-xs text-muted-foreground">近期</p>
                    </button>
                    <button
                      type="button"
                      disabled={overdueTotal === 0}
                      onClick={() => onSelectStatusFilter?.('attention')}
                      aria-label={`筛选待关注疫苗（含 ${overdueTotal} 剂待补种）`}
                      className="cursor-pointer rounded-xl border border-border/70 bg-muted/35 px-2 py-2 text-center transition-colors outline-none hover:border-destructive/50 hover:bg-destructive-soft/35 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-75 disabled:hover:border-border/70 disabled:hover:bg-muted/35"
                    >
                      <p
                        className={cn(
                          'text-base font-semibold tabular-nums',
                          overdueTotal > 0 ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {overdueTotal}
                      </p>
                      <p className="text-xs text-muted-foreground">待补种</p>
                    </button>
                  </>
                );
              })()}
            </div>

            {/* 常去接种门诊快速查看与行内设置：预约/打卡与导出日历均自动带出 */}
            <div className="rounded-xl border border-border/75 bg-muted/25 px-3 py-2.5">
              {editingClinic ? (
                <form onSubmit={(e) => void handleSubmitDefaultClinic(e)} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Pin className="size-3.5 text-primary" />
                      设置常去接种门诊
                    </span>
                    <button
                      type="button"
                      aria-label="取消编辑常去门诊"
                      disabled={savingDefaultClinic}
                      onClick={() => setEditingClinic(false)}
                      className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      value={clinicDraft}
                      maxLength={80}
                      disabled={savingDefaultClinic}
                      placeholder="如 XX 街道社区卫生服务中心（留空清除）"
                      className="h-9 pr-8 text-base md:h-8 md:text-xs"
                      onChange={(e) => setClinicDraft(e.target.value)}
                    />
                    {clinicDraft ? (
                      <button
                        type="button"
                        aria-label="清空常去门诊"
                        disabled={savingDefaultClinic}
                        onClick={() => setClinicDraft('')}
                        className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {overview.recent_clinics.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {overview.recent_clinics.map((clinic) => (
                        <QuickChip
                          key={clinic}
                          variant="outline"
                          disabled={savingDefaultClinic}
                          active={clinicDraft === clinic}
                          onClick={() => setClinicDraft(clinic)}
                        >
                          {clinic}
                        </QuickChip>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={savingDefaultClinic}
                      className="h-7 px-2 text-xs"
                      onClick={() => setEditingClinic(false)}
                    >
                      取消
                    </Button>
                    <Button type="submit" size="sm" disabled={savingDefaultClinic} className="h-7 px-2.5 text-xs">
                      {savingDefaultClinic ? (
                        <Spinner className="size-3" aria-hidden="true" role="presentation" />
                      ) : null}
                      {savingDefaultClinic ? '保存中…' : '保存'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs">
                    <Pin className="size-3.5 shrink-0 text-primary" />
                    <span className="shrink-0 text-muted-foreground">常去门诊</span>
                    <span
                      className={cn(
                        'truncate font-medium',
                        overview.default_clinic_name ? 'text-foreground' : 'text-muted-foreground',
                      )}
                      title={overview.default_clinic_name || undefined}
                    >
                      {overview.default_clinic_name || '首次预约后自动记住'}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={startEditDefaultClinic}
                  >
                    <PencilIcon className="size-3" />
                    {overview.default_clinic_name ? '修改' : '设置'}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
