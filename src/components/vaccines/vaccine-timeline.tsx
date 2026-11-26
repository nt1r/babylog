import {
  CalendarCheck2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MapPin,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatShortCnDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  formatDaysUntilLabel,
  formatDoseOrderLabel,
  getAlertBadgeMeta,
  groupDosesByAgeStage,
  type VaccineDose,
} from '@/lib/vaccines';

interface VaccineTimelineProps {
  readonly doses: readonly VaccineDose[];
  readonly today: string;
  readonly hasActiveFilter?: boolean;
  readonly onResetFilters?: () => void;
  readonly onSelectDose: (dose: VaccineDose) => void;
  readonly onBatchSchedule: (doseIds: number[], stageLabel: string, defaultDate: string) => void;
  readonly onBatchComplete: (doseIds: number[], stageLabel: string, defaultDate: string) => void;
}

/** 按适龄月龄分组的接种计划时间轴：已完成的过往阶段默认折叠，并支持同月龄合并预约与快速补录。 */
export function VaccineTimeline({
  doses,
  today,
  hasActiveFilter = false,
  onResetFilters,
  onSelectDose,
  onBatchSchedule,
  onBatchComplete,
}: VaccineTimelineProps) {
  const stages = groupDosesByAgeStage(doses);
  // 已全部完成的过往月龄默认折叠，允许用户随时点击展开查看接种档案。
  const [toggledStages, setToggledStages] = useState<Record<number, boolean>>({});

  function isStageExpanded(ageMonths: number, allCompleted: boolean): boolean {
    if (ageMonths in toggledStages) {
      return toggledStages[ageMonths];
    }
    return !allCompleted;
  }

  function toggleStage(ageMonths: number, currentExpanded: boolean) {
    setToggledStages((prev) => ({ ...prev, [ageMonths]: !currentExpanded }));
  }

  const completedStages = stages.filter((s) => s.allCompleted);
  const allCompletedExpanded =
    completedStages.length > 0 && completedStages.every((s) => isStageExpanded(s.ageMonths, true));

  function handleToggleAllCompleted() {
    const nextExpanded = !allCompletedExpanded;
    setToggledStages((prev) => {
      const next = { ...prev };
      for (const s of completedStages) {
        next[s.ageMonths] = nextExpanded;
      }
      return next;
    });
  }

  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">当前筛选条件下没有匹配的疫苗剂次</p>
          <p className="text-xs text-muted-foreground">尝试切换上方状态或免费/自费筛选条件查看全部计划。</p>
        </div>
        {hasActiveFilter && onResetFilters ? (
          <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
            <RotateCcw className="size-3.5" />
            重置筛选
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {completedStages.length > 0 ? (
        <div className="flex items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">共 {completedStages.length} 个过往月龄阶段已全部接种完成</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleToggleAllCompleted}
            className="text-muted-foreground hover:text-foreground"
          >
            {allCompletedExpanded ? (
              <>
                <ChevronsDownUp className="size-3.5" />
                折叠已完成
              </>
            ) : (
              <>
                <ChevronsUpDown className="size-3.5" />
                展开已完成
              </>
            )}
          </Button>
        </div>
      ) : null}
      {stages.map((stage) => {
        const expanded = isStageExpanded(stage.ageMonths, stage.allCompleted);
        const canBatchAct = stage.pendingDoseIds.length > 0;
        const defaultCompleteDate = stage.earliestDate <= today ? stage.earliestDate : today;

        return (
          <section
            key={stage.ageMonths}
            aria-label={`${stage.ageLabel}疫苗接种计划`}
            className={cn(
              'overflow-hidden rounded-2xl border transition-colors',
              stage.hasAttention ? 'border-warning/40 bg-card' : 'border-border/80 bg-card',
            )}
          >
            {/* 月龄阶段头：折叠切换 + 完成进度 + 同月龄批量操作 */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/35 px-4 py-3">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleStage(stage.ageMonths, expanded)}
                className="flex min-w-0 cursor-pointer items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm font-semibold text-foreground">{stage.ageLabel}</span>
                {stage.allCompleted ? (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    已完成 {stage.completedCount}/{stage.totalCount}
                  </Badge>
                ) : (
                  <Badge variant={stage.hasAttention ? 'warning' : 'secondary'} className="tabular-nums">
                    {stage.completedCount}/{stage.totalCount} 剂
                  </Badge>
                )}
              </button>

              {canBatchAct ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => onBatchSchedule(stage.pendingDoseIds, stage.ageLabel, stage.earliestDate)}
                  >
                    <CalendarCheck2 className="size-3.5" />
                    {stage.pendingDoseIds.length > 1 ? '合并预约' : '登记预约'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => onBatchComplete(stage.pendingDoseIds, stage.ageLabel, defaultCompleteDate)}
                  >
                    <CheckCheck className="size-3.5" />
                    {stage.pendingDoseIds.length > 1 ? '一键已接种' : '标记已接种'}
                  </Button>
                </div>
              ) : null}
            </div>

            {expanded ? (
              <div className="divide-y divide-border/70">
                {stage.doses.map((dose) => {
                  const badgeMeta = getAlertBadgeMeta(dose.alert_state);
                  const datePrefix =
                    dose.status === 'completed' ? '接种于' : dose.status === 'scheduled' ? '预约于' : '预计';

                  return (
                    <button
                      key={dose.id}
                      type="button"
                      onClick={() => onSelectDose(dose)}
                      className="flex w-full cursor-pointer flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-muted/35 focus-visible:bg-muted/45 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('size-2 shrink-0 rounded-full', badgeMeta.dotClass)} />
                          <span className="text-sm font-semibold text-foreground">{dose.vaccine_name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatDoseOrderLabel(dose)}
                          </span>
                          <Badge variant={dose.category === 'nip' ? 'secondary' : 'health'}>
                            {dose.category === 'nip' ? '免费' : '自费'}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-xs text-muted-foreground">
                          <span className="tabular-nums">
                            {datePrefix} {formatShortCnDate(dose.effective_date, today)}
                            {dose.status === 'scheduled' && dose.scheduled_time ? ` ${dose.scheduled_time}` : ''}
                          </span>
                          {dose.status !== 'completed' ? (
                            <span
                              className={cn(
                                'tabular-nums',
                                (dose.alert_state === 'overdue' || dose.alert_state === 'scheduled_overdue') &&
                                  'font-medium text-destructive',
                                dose.alert_state === 'due_soon' && 'font-medium text-warning-soft-foreground',
                                dose.alert_state === 'scheduled_soon' && 'font-medium text-info-soft-foreground',
                              )}
                            >
                              {formatDaysUntilLabel(dose.days_until, dose.status)}
                            </span>
                          ) : null}
                          {dose.route ? <span>{dose.route}</span> : null}
                          {dose.clinic_name ? (
                            <span className="inline-flex items-center gap-1 truncate">
                              <MapPin className="size-3 shrink-0" />
                              {dose.clinic_name}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center justify-between gap-2 pl-4 sm:justify-end sm:pl-0">
                        <Badge variant={badgeMeta.variant}>{badgeMeta.label}</Badge>
                        <ChevronRight className="size-4 text-muted-foreground/70" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
