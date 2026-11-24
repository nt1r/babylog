import { Link } from '@tanstack/react-router';
import { ArrowUpRight, HeartPulse, MapPin, PlusIcon, RotateCw, Ruler, Syringe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  buildGrowthMetricTiles,
  type DashboardGrowthSummary,
  type DashboardVaccineAlertBanner,
  formatTeethSummaryText,
  type PostVaccineTempCue,
  selectDashboardVaccineCardFocus,
} from '@/lib/dashboard';
import { cn } from '@/lib/utils';
import {
  formatDaysUntilLabel,
  formatDoseShortTitle,
  formatShortCnDate,
  getAlertBadgeMeta,
  type VaccineOverviewResponse,
} from '@/lib/vaccines';
import type { GrowthEntrySubtype } from '@/stores/growth-record';

/** 条件浮现的首屏疫苗常驻提醒条（产院未确认 / 预约逾期 / 临期 / 待补种），窄屏允许自然换行避免关键信息被截断。 */
export function DashboardVaccineBanner({ alert }: { readonly alert: DashboardVaccineAlertBanner }) {
  return (
    <Link
      to="/vaccines"
      aria-label="疫苗接种提醒"
      className={cn(
        'group flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        alert.tone === 'destructive' && 'border-destructive/40 bg-destructive-soft/40 hover:border-destructive/65',
        alert.tone === 'info' && 'border-info/40 bg-info-soft/45 hover:border-info/65',
        alert.tone === 'warning' && 'border-warning/40 bg-warning-soft/45 hover:border-warning/65',
        alert.tone === 'primary' && 'border-primary/35 bg-accent/45 hover:border-primary/60',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-health-soft text-health-soft-foreground sm:mt-0">
          <Syringe className="size-4.5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant={alert.badgeVariant}>{alert.badgeLabel}</Badge>
            <span className="line-clamp-2 text-sm leading-snug font-semibold text-foreground tabular-nums">
              {alert.title}
            </span>
            {alert.countdown ? (
              <span className="text-xs font-medium text-primary tabular-nums">{alert.countdown}</span>
            ) : null}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{alert.detail}</p>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
        前往处理
        <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

/** 接种后 48 小时轻量测温联动提示条，独立于 summary 接口状态展示并在窄屏完整换行呈现。 */
export function PostVaccineTempCueBar({
  cue,
  onLogTemperature,
}: {
  readonly cue: PostVaccineTempCue;
  readonly onLogTemperature: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-health/30 bg-health-soft/35 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-relaxed text-health-soft-foreground sm:items-center">
        <HeartPulse className="mt-0.5 size-4 shrink-0 sm:mt-0" strokeWidth={1.8} />
        <span>刚接种过「{cue.doseNames.join('、')}」，接种后 48 小时内注意观察宝宝体温与精神状态</span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 shrink-0 bg-card text-xs"
        onClick={onLogTemperature}
      >
        去记体温
      </Button>
    </div>
  );
}

interface DashboardVaccineCardProps {
  readonly overview: VaccineOverviewResponse | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
}

/** 看板下方左卡：疫苗接种计划与免疫进度。 */
export function DashboardVaccineCard({ overview, isLoading, isError, onRetry }: DashboardVaccineCardProps) {
  const focus = overview?.summary.next_focus ?? null;
  const { showBirthConfirm, birthPendingDoses, focusDoses, nipPercent } = selectDashboardVaccineCardFocus(overview);

  return (
    <Card className="flex h-full flex-col justify-between">
      <div>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-health-soft text-health-soft-foreground">
              <Syringe className="size-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-base whitespace-nowrap">疫苗接种计划</CardTitle>
                {overview ? (
                  showBirthConfirm ? (
                    <Badge variant="warning">待确认</Badge>
                  ) : focus ? (
                    <Badge variant={getAlertBadgeMeta(focus.kind).variant}>{getAlertBadgeMeta(focus.kind).label}</Badge>
                  ) : (
                    <Badge variant="success">全部完成</Badge>
                  )
                ) : null}
              </div>
              <CardDescription className="truncate">下次接种与免疫进度</CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            render={<Link to="/vaccines" />}
            nativeButton={false}
          >
            查看计划
            <ArrowUpRight className="size-3.5" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-7 w-44 rounded-lg" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ) : isError || !overview ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-3.5 py-4">
              <p className="text-xs text-muted-foreground">疫苗计划暂时加载失败</p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCw className="size-3.5" />
                重试
              </Button>
            </div>
          ) : showBirthConfirm ? (
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-foreground">请核对产院出生疫苗接种记录</p>
              <div className="flex flex-wrap gap-1.5">
                {birthPendingDoses.map((dose) => (
                  <span
                    key={dose.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-secondary/60 px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    <Syringe className="size-3 text-health" />
                    {formatDoseShortTitle(dose)}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">对照出院小结或接种证在疫苗页一键确认日期</p>
            </div>
          ) : focus ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  {formatShortCnDate(focus.target_date, overview.today)}
                  {focus.scheduled_time ? ` ${focus.scheduled_time}` : ''}
                </span>
                <span className="text-xs font-medium text-primary tabular-nums">
                  {formatDaysUntilLabel(focus.days_until, focus.kind.startsWith('scheduled') ? 'scheduled' : 'pending')}
                </span>
                <Badge variant="outline" className="font-normal">
                  {focus.age_label}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {focusDoses.slice(0, 3).map((dose) => (
                  <span
                    key={dose.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-secondary/60 px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    <Syringe className="size-3 text-health" />
                    {formatDoseShortTitle(dose)}
                  </span>
                ))}
                {focusDoses.length > 3 ? (
                  <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums">
                    +{focusDoses.length - 3} 剂
                  </span>
                ) : null}
              </div>

              {focus.clinic_name ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate">{focus.clinic_name}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-success-soft-foreground">当前计划疫苗已全部接种完成。</p>
          )}
        </CardContent>
      </div>

      {overview ? (
        <CardContent className="space-y-3 pt-0">
          <Separator />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">免费规划进度</span>
              <span className="font-semibold text-foreground tabular-nums">
                {overview.summary.nip_completed} / {overview.summary.nip_total} 剂（{nipPercent}%）
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="免费规划疫苗接种进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={nipPercent}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${nipPercent}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border/70 bg-muted/30 px-2 py-1.5 text-center">
              <p className="text-sm font-semibold text-info-soft-foreground tabular-nums">
                {overview.summary.scheduled_count}
              </p>
              <p className="text-xs text-muted-foreground">已预约</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 px-2 py-1.5 text-center">
              <p className="text-sm font-semibold text-warning-soft-foreground tabular-nums">
                {overview.summary.due_soon_count + overview.summary.scheduled_soon_count}
              </p>
              <p className="text-xs text-muted-foreground">近期</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 px-2 py-1.5 text-center">
              <p
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  overview.summary.overdue_count + overview.summary.scheduled_overdue_count > 0
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {overview.summary.overdue_count + overview.summary.scheduled_overdue_count}
              </p>
              <p className="text-xs text-muted-foreground">待补种</p>
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

interface DashboardGrowthCardProps {
  readonly growth: DashboardGrowthSummary | undefined;
  readonly referenceDateStr: string | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly onOpenCreate: (subtype: GrowthEntrySubtype) => void;
}

/** 看板下方右卡：最新生长发育（复用共享体格指标构建器与出牙里程碑汇总）。 */
export function DashboardGrowthCard({
  growth,
  referenceDateStr,
  isLoading,
  isError,
  onRetry,
  onOpenCreate,
}: DashboardGrowthCardProps) {
  const tiles = buildGrowthMetricTiles(growth, referenceDateStr);
  const teethSummary = formatTeethSummaryText(
    growth,
    referenceDateStr,
    '尚未记录出牙，萌出第一颗乳牙时记得打卡',
    '最近记录：',
  );

  return (
    <Card className="flex h-full flex-col justify-between">
      <div>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-health-soft text-health-soft-foreground">
              <Ruler className="size-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base whitespace-nowrap">最新生长发育</CardTitle>
              <CardDescription className="truncate">体格测量与出牙里程碑</CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => onOpenCreate('growth')}
            >
              <PlusIcon className="size-3.5" />
              记一笔
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              render={<Link to="/growth" />}
              nativeButton={false}
            >
              全部
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          ) : isError ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-3.5 py-4">
              <p className="text-xs text-muted-foreground">生长数据暂时加载失败</p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCw className="size-3.5" />
                重试
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              {tiles.map((tile) => (
                <div
                  key={tile.key}
                  className="flex min-w-0 flex-col justify-between gap-1 rounded-xl border border-border/75 bg-muted/25 px-2.5 py-2.5 sm:px-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs text-muted-foreground">{tile.shortLabel}</span>
                    {tile.isBirth ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal">
                        出生
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-base font-semibold tracking-tight whitespace-nowrap text-foreground tabular-nums sm:text-lg">
                    {tile.value}
                  </p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">{tile.compactDate}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </div>

      <CardContent className="space-y-3 pt-0">
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">乳牙萌出</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {growth && growth.teeth_count > 0 ? `已出 ${growth.teeth_count} 颗` : '0 颗'}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{teethSummary}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs text-primary"
            onClick={() => onOpenCreate('teeth')}
          >
            记出牙
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
