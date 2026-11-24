import { ArrowRight, Baby, CalendarClock, CheckCircle2, MapPin, ShieldAlert, Syringe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { VaccineCalendar } from '@/components/vaccines/vaccine-calendar';
import { cn } from '@/lib/utils';
import {
  formatDaysUntilLabel,
  formatDoseShortTitle,
  formatShortCnDate,
  getAlertBadgeMeta,
  type VaccineDose,
  type VaccineOverviewResponse,
} from '@/lib/vaccines';

export interface BirthConfirmItem {
  readonly dose: VaccineDose;
  readonly vaccinatedAt: string;
}

interface VaccineOverviewProps {
  readonly overview: VaccineOverviewResponse;
  readonly babyNickname?: string;
  readonly birthConfirmDismissed: boolean;
  readonly confirmingBirth: boolean;
  readonly onConfirmBirthDoses: (items: readonly BirthConfirmItem[]) => void;
  readonly onDismissBirthConfirm: () => void;
  readonly onOpenDose: (dose: VaccineDose) => void;
  readonly onOpenBatchScheduleFocus: (doseIds: number[], label: string, defaultDate: string) => void;
}

/** 根据出生日期推导卡介苗默认接种日（常规为出生次日，若今天即出生当天则取出生当天）。 */
function getDefaultBirthDoseDate(dose: VaccineDose, birthDate: string, today: string): string {
  if (dose.template_code !== 'bcg') {
    return birthDate;
  }
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return birthDate;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return nextKey <= today ? nextKey : birthDate;
}

/** 疫苗页首屏总览区：精简风险声明、产院疫苗确认，以及「直观接种日历 + 下次接种与进度」双栏视图。 */
export function VaccineOverview({
  overview,
  babyNickname,
  birthConfirmDismissed,
  confirmingBirth,
  onConfirmBirthDoses,
  onDismissBirthConfirm,
  onOpenDose,
  onOpenBatchScheduleFocus,
}: VaccineOverviewProps) {
  const { summary, doses, today } = overview;
  const focus = summary.next_focus;
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
      {/* 单行紧凑风险提示：精简不占屏，始终强调须自行核实 */}
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-2.5 text-xs leading-relaxed text-warning-soft-foreground"
      >
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>{overview.disclaimer}</span>
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
                  <Input
                    type="date"
                    aria-label={`${label}实际接种日期`}
                    min={overview.birth_date}
                    max={today}
                    disabled={!entry.checked || confirmingBirth}
                    value={entry.date}
                    onChange={(e) =>
                      setBirthSelection((prev) => ({
                        ...prev,
                        [dose.id]: { ...entry, date: e.target.value },
                      }))
                    }
                    className="h-8 w-36 shrink-0 rounded-lg px-2 py-0.5 text-base tabular-nums sm:w-[8.75rem] md:text-[13px]"
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

                  <div className="pt-0.5">
                    {focus.dose_ids.length > 1 && !focus.kind.startsWith('scheduled') ? (
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
              <div className="rounded-xl border border-border/70 bg-muted/35 px-2 py-2 text-center">
                <p className="text-base font-semibold text-info-soft-foreground tabular-nums">
                  {summary.scheduled_count}
                </p>
                <p className="text-xs text-muted-foreground">已预约</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/35 px-2 py-2 text-center">
                <p className="text-base font-semibold text-warning-soft-foreground tabular-nums">
                  {summary.due_soon_count + summary.scheduled_soon_count}
                </p>
                <p className="text-xs text-muted-foreground">近期</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/35 px-2 py-2 text-center">
                <p
                  className={cn(
                    'text-base font-semibold tabular-nums',
                    summary.overdue_count + summary.scheduled_overdue_count > 0
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {summary.overdue_count + summary.scheduled_overdue_count}
                </p>
                <p className="text-xs text-muted-foreground">待补种</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
