import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Syringe } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoPopover } from '@/components/ui/info-popover';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { exportVaccineVisitIcs } from '@/lib/ics';
import { formatShortCnDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  buildCalendarIcsOptions,
  buildVaccineCalendarMonth,
  formatDoseShortTitle,
  getAlertBadgeMeta,
  resolveCalendarExportTarget,
  type VaccineDose,
  type VaccineNextFocus,
} from '@/lib/vaccines';

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;

interface VaccineCalendarProps {
  readonly doses: readonly VaccineDose[];
  readonly today: string;
  readonly defaultClinicName: string;
  readonly nextFocus: VaccineNextFocus | null;
  readonly babyNickname?: string;
  readonly onSelectDose: (dose: VaccineDose) => void;
}

function parseYearMonth(dateStr: string): { year: number; monthIndex: number } {
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m) {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }
  return { year: y, monthIndex: m - 1 };
}

/**
 * 首屏紧凑型自然月接种日历卡片：
 * 默认自动定格在下一次接种所在月份，内置全页唯一的「导出日历 (.ics)」入口，
 * 并在日历下方联动展示选中日期或当月全部接种条目。
 */
export function VaccineCalendar({
  doses,
  today,
  defaultClinicName,
  nextFocus,
  babyNickname,
  onSelectDose,
}: VaccineCalendarProps) {
  const initialYM = parseYearMonth(nextFocus?.target_date ?? today);
  const [year, setYear] = useState(initialYM.year);
  const [monthIndex, setMonthIndex] = useState(initialYM.monthIndex);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const { cells, monthDoses } = useMemo(
    () => buildVaccineCalendarMonth(year, monthIndex, doses, today),
    [year, monthIndex, doses, today],
  );

  const selectedDayDoses = useMemo(() => {
    if (!selectedDateKey) return [];
    return doses.filter((d) => d.effective_date === selectedDateKey);
  }, [doses, selectedDateKey]);

  const exportTarget = useMemo(
    () =>
      resolveCalendarExportTarget({
        selectedDateKey,
        selectedDayDoses,
        monthDoses,
        nextFocus,
        allDoses: doses,
      }),
    [selectedDateKey, selectedDayDoses, monthDoses, nextFocus, doses],
  );

  function shiftMonth(delta: number) {
    const dt = new Date(Date.UTC(year, monthIndex + delta, 1));
    setYear(dt.getUTCFullYear());
    setMonthIndex(dt.getUTCMonth());
    setSelectedDateKey(null);
  }

  function jumpToDate(dateStr: string) {
    const ym = parseYearMonth(dateStr);
    setYear(ym.year);
    setMonthIndex(ym.monthIndex);
    setSelectedDateKey(dateStr);
  }

  function handleExportCalendar() {
    if (!exportTarget) return;
    exportVaccineVisitIcs(buildCalendarIcsOptions(exportTarget, defaultClinicName, babyNickname));
    toast.success(
      '已导出接种日历',
      `已生成 ${formatShortCnDate(exportTarget.date, today)} 的接种提醒，打开即可添加到手机日历`,
    );
  }

  const nextFocusDate = nextFocus?.target_date ?? null;
  const activeList = selectedDateKey ? selectedDayDoses : monthDoses;

  return (
    <Card className="flex h-full flex-col gap-3">
      <CardHeader className="flex flex-col gap-2.5 pb-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <CalendarDays className="size-4 text-health" />
            <span>接种日历</span>
            <InfoPopover title="日历与导出说明" ariaLabel="查看接种日历与导出说明">
              <div className="space-y-2">
                <p>点选日历中的具体日期可筛选当天安排；再次点击已选中日期可切回整月视图。</p>
                <p>
                  点击「导出日历」会生成手机日程文件（含接种时间、门诊地点、注意事项与提前提醒），打开即可添加到手机日历。
                </p>
              </div>
            </InfoPopover>
          </CardTitle>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="上个月"
                    onClick={() => shiftMonth(-1)}
                  />
                }
              >
                <ChevronLeft className="size-4" />
              </TooltipTrigger>
              <TooltipContent>上个月</TooltipContent>
            </Tooltip>
            <span className="min-w-24 text-center text-sm font-semibold text-foreground tabular-nums">
              {year}年{monthIndex + 1}月
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="下个月"
                    onClick={() => shiftMonth(1)}
                  />
                }
              >
                <ChevronRight className="size-4" />
              </TooltipTrigger>
              <TooltipContent>下个月</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => jumpToDate(today)}>
            今天
          </Button>
          {nextFocusDate ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => jumpToDate(nextFocusDate)}>
              下次接种
            </Button>
          ) : null}
          {exportTarget ? (
            <Tooltip>
              <TooltipTrigger
                render={<Button type="button" variant="outline" size="sm" onClick={handleExportCalendar} />}
              >
                <CalendarPlus className="size-3.5" />
                {exportTarget.isFallbackFocus ? '导出下次' : '导出日历'}
              </TooltipTrigger>
              <TooltipContent>导出 {formatShortCnDate(exportTarget.date, today)} 的接种日程</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button type="button" variant="outline" size="sm" disabled>
                  <CalendarPlus className="size-3.5" />
                  导出日历
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {selectedDateKey ? '所选日期暂无未完成的接种日程' : '当前暂无可导出的接种日程'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {/* 状态色图例 */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" />
            已接种
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-info" />
            已预约
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" />
            近期
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            待补种
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/50" />
            未到龄
          </span>
        </div>

        {/* 紧凑 7 列自然月日历网格 */}
        <div className="overflow-hidden rounded-xl border border-border/80 bg-background/40">
          <div className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
            {WEEKDAY_HEADERS.map((wd) => (
              <div key={wd} className="py-1.5 text-center text-xs font-medium text-muted-foreground">
                周{wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-border/60">
            {cells.map((cell) => {
              const isSelected = selectedDateKey === cell.dateKey;
              const isNextFocusDay = nextFocusDate === cell.dateKey;
              const hasDoses = cell.doses.length > 0;
              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onClick={() => setSelectedDateKey(isSelected ? null : cell.dateKey)}
                  aria-label={`${cell.dateKey}${hasDoses ? `，有 ${cell.doses.length} 剂疫苗` : ''}`}
                  className={cn(
                    'flex min-h-12 cursor-pointer flex-col items-stretch gap-1 p-1 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[4.25rem] sm:p-1.5',
                    !cell.inCurrentMonth && 'bg-muted/20 text-muted-foreground/55',
                    cell.inCurrentMonth && 'hover:bg-muted/35',
                    isNextFocusDay && !isSelected && 'bg-health-soft/30',
                    isSelected && 'bg-accent/75 ring-1 ring-inset ring-primary/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'inline-flex size-5 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                        cell.isToday && 'bg-primary text-primary-foreground',
                        !cell.isToday && isNextFocusDay && 'font-semibold text-health-soft-foreground',
                        !cell.isToday && !isNextFocusDay && cell.inCurrentMonth && 'text-foreground',
                      )}
                    >
                      {cell.day}
                    </span>
                    {hasDoses ? (
                      <span className="text-xs font-medium text-muted-foreground tabular-nums sm:hidden">
                        {cell.doses.length}
                      </span>
                    ) : null}
                  </div>

                  {hasDoses ? (
                    <>
                      <div className="flex flex-wrap gap-1 sm:hidden">
                        {cell.doses.slice(0, 3).map((d) => (
                          <span
                            key={d.id}
                            className={cn('size-2 rounded-full', getAlertBadgeMeta(d.alert_state).dotClass)}
                          />
                        ))}
                      </div>
                      <div className="hidden flex-col gap-0.5 sm:flex">
                        {cell.doses.slice(0, 2).map((d) => {
                          const meta = getAlertBadgeMeta(d.alert_state);
                          return (
                            <span
                              key={d.id}
                              className={cn(
                                'inline-flex items-center gap-1 truncate rounded px-1 py-0.5 text-xs leading-none',
                                meta.pillClass,
                              )}
                            >
                              <span className={cn('size-1.5 shrink-0 rounded-full', meta.dotClass)} />
                              <span className="truncate">{d.short_name}</span>
                            </span>
                          );
                        })}
                        {cell.doses.length > 2 ? (
                          <span className="px-1 text-xs leading-none text-muted-foreground">
                            +{cell.doses.length - 2}
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* 日历底部极简联动条：展示选中日或当月接种胶囊，点选直达详情 */}
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="font-medium text-foreground">
              {selectedDateKey
                ? `${formatShortCnDate(selectedDateKey, today)} 安排（${activeList.length}）`
                : `${year}年${monthIndex + 1}月安排（${activeList.length}）`}
            </span>
            {selectedDateKey ? (
              <button
                type="button"
                onClick={() => setSelectedDateKey(null)}
                className="cursor-pointer text-[13px] font-medium text-primary hover:underline"
              >
                看整月
              </button>
            ) : null}
          </div>

          {activeList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {selectedDateKey ? '当天暂无接种安排。' : '本月暂无接种安排，可点击「下次接种」快速跳转。'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeList.map((dose) => {
                const badgeMeta = getAlertBadgeMeta(dose.alert_state);
                return (
                  <button
                    key={dose.id}
                    type="button"
                    onClick={() => onSelectDose(dose)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1 text-[13px] text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    <span className={cn('size-1.5 shrink-0 rounded-full', badgeMeta.dotClass)} />
                    <Syringe className="size-3.5 text-health" />
                    <span className="font-medium">{formatDoseShortTitle(dose)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatShortCnDate(dose.effective_date, today)}
                    </span>
                    <Badge variant={badgeMeta.variant} className="px-1.5 py-0">
                      {badgeMeta.label}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
