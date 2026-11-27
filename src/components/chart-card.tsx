import { AlertCircle, Download, RotateCw } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { type ChartExportLegendItem, exportChartContainerToPng } from '@/lib/chart-export';
import { cn } from '@/lib/utils';

interface ChartCardExportSpec {
  readonly title?: string;
  readonly subtitle?: string;
  readonly filenameBase: string;
  readonly legend?: readonly ChartExportLegendItem[];
  readonly successMessage?: string;
  readonly ariaLabel?: string;
}

interface ChartCardStatus {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
  readonly errorVariant?: 'muted' | 'destructive';
}

interface ChartCardEmptyState {
  readonly isEmpty: boolean;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

interface ChartCardProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly titleExtra?: ReactNode;
  readonly headerExtra?: ReactNode;
  readonly exportSpec?: ChartCardExportSpec;
  readonly status: ChartCardStatus;
  readonly empty: ChartCardEmptyState;
  readonly beforeChart?: ReactNode;
  readonly footer?: ReactNode;
  readonly note?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 跨页面共享图表卡片壳层：统一承载标题、切换控件、加载/错误重试/空态以及可选高清图片导出（含防重入锁），
 * 供统计分析页、生长发育曲线与首页看板共用，避免多处重复维护卡片骨架与保存图片逻辑。
 */
export function ChartCard({
  title,
  description,
  icon,
  titleExtra,
  headerExtra,
  exportSpec,
  status,
  empty,
  beforeChart,
  footer,
  note,
  className,
  children,
}: ChartCardProps) {
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  const canExport = Boolean(exportSpec) && !status.isLoading && !status.isError && !empty.isEmpty;

  async function handleSaveImage() {
    if (!canExport || !exportSpec || busyRef.current || !chartBoxRef.current) return;
    busyRef.current = true;
    setExporting(true);
    try {
      await exportChartContainerToPng({
        container: chartBoxRef.current,
        title: exportSpec.title ?? title,
        subtitle: exportSpec.subtitle,
        filenameBase: exportSpec.filenameBase,
        legend: exportSpec.legend,
      });
      toast.success(exportSpec.successMessage ?? '趋势图已保存为图片');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存图片失败，请稍后重试');
    } finally {
      busyRef.current = false;
      setExporting(false);
    }
  }

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              {icon}
              <span>{title}</span>
            </CardTitle>
            {titleExtra}
          </div>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {headerExtra || canExport ? (
          <div className="flex flex-wrap items-center gap-2">
            {headerExtra}
            {canExport && exportSpec ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => void handleSaveImage()}
                className="h-8 gap-1.5 px-2.5 text-xs"
                aria-label={exportSpec.ariaLabel ?? `将${title}保存为图片`}
              >
                {exporting ? (
                  <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
                ) : (
                  <Download className="size-3.5" strokeWidth={1.8} />
                )}
                <span>保存图片</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {status.isLoading ? (
          <Skeleton className="h-60 w-full rounded-xl" />
        ) : status.isError ? (
          status.errorVariant === 'destructive' ? (
            <div className="flex h-52 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive-soft/20 p-6 text-center">
              <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
              <p className="text-sm text-destructive-soft-foreground">{status.errorMessage ?? '数据加载失败'}</p>
              {status.onRetry ? (
                <Button type="button" size="sm" variant="outline" onClick={status.onRetry}>
                  <RotateCw className="size-3.5" />
                  重新加载
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
              <p className="text-sm text-muted-foreground">{status.errorMessage ?? '统计数据加载失败'}</p>
              {status.onRetry ? (
                <Button type="button" variant="outline" size="sm" onClick={status.onRetry}>
                  <RotateCw className="size-3.5" />
                  重新加载
                </Button>
              ) : null}
            </div>
          )
        ) : empty.isEmpty ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium text-foreground">{empty.title}</p>
            {empty.description ? <p className="max-w-xs text-xs text-muted-foreground">{empty.description}</p> : null}
            {empty.action}
          </div>
        ) : (
          <>
            {beforeChart}
            <div ref={chartBoxRef} className="w-full">
              {children}
            </div>
            {footer ? <div className="border-t border-border/60 pt-2.5">{footer}</div> : null}
            {note}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 统一图表自定义悬浮提示外壳，保证各业务图表 Tooltip 圆角、边框与排版一致。 */
export function ChartTooltipCard({
  title,
  titleExtra,
  minWidthClass = 'min-w-40',
  children,
}: {
  readonly title: ReactNode;
  readonly titleExtra?: ReactNode;
  readonly minWidthClass?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md',
        minWidthClass,
      )}
    >
      <div className="flex items-center justify-between gap-3 font-medium text-foreground tabular-nums">
        <span>{title}</span>
        {titleExtra}
      </div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

/** 统一图表悬浮提示行原语，支持可选语义色点与强调态。 */
export function ChartTooltipRow({
  label,
  value,
  swatchClass,
  emphasize = false,
  mutedValue = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly swatchClass?: string;
  readonly emphasize?: boolean;
  readonly mutedValue?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        emphasize ? 'font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      <span className="flex items-center gap-1.5">
        {swatchClass ? <span className={cn('size-2 shrink-0 rounded-full', swatchClass)} /> : null}
        {label}
      </span>
      <span
        className={cn(
          'tabular-nums',
          emphasize ? 'font-semibold text-foreground' : mutedValue ? undefined : 'font-medium text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

const CARE_RHYTHM_CHART_CONFIG: ChartConfig = {
  count: { label: '照护次数', color: 'var(--sleep)' },
};

/** 全天 5 时段照护节律柱状图，供首页看板与统计分析页共用同一坐标与视觉口径。 */
export function CareRhythmBarChart({
  slots,
  maxBarSize = 36,
}: {
  readonly slots: ReadonlyArray<{ readonly slot: string; readonly count: number }>;
  readonly maxBarSize?: number;
}) {
  return (
    <ChartContainer config={CARE_RHYTHM_CHART_CONFIG} className="aspect-auto h-60 w-full">
      <BarChart data={[...slots]} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="slot" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent unit="次" />} />
        <Bar
          dataKey="count"
          fill="var(--sleep)"
          radius={[8, 8, 2, 2]}
          maxBarSize={maxBarSize}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
