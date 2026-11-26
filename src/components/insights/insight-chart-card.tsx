import { Download, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useChartImageExport } from '@/hooks/use-chart-image-export';
import type { ChartExportLegendItem } from '@/lib/chart-export';
import { cn } from '@/lib/utils';

interface InsightChartCardProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly headerExtra?: ReactNode;
  readonly exportSubtitle?: string;
  readonly exportFilenameBase: string;
  readonly exportLegend?: readonly ChartExportLegendItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 统计分析通用图表卡片壳层：统一承载标题、切换控件、空态/加载/报错重试与一键高清图片导出。
 */
export function InsightChartCard({
  title,
  description,
  icon,
  headerExtra,
  exportSubtitle,
  exportFilenameBase,
  exportLegend,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  footer,
  className,
  children,
}: InsightChartCardProps) {
  const { containerRef: chartBoxRef, exporting, saveImage } = useChartImageExport();

  const canExport = !isLoading && !isError && !isEmpty;

  function handleSaveImage() {
    if (!canExport) return;
    void saveImage({
      title,
      subtitle: exportSubtitle,
      filenameBase: exportFilenameBase,
      legend: exportLegend,
      successMessage: '趋势图已保存为图片',
    });
  }

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-1.5 text-base">
            {icon}
            <span>{title}</span>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          {canExport ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void handleSaveImage()}
              className="h-8 gap-1.5 px-2.5 text-xs"
              aria-label={`将${title}保存为图片`}
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
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          <Skeleton className="h-60 w-full rounded-xl" />
        ) : isError ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
            <p className="text-sm text-muted-foreground">{errorMessage ?? '统计数据加载失败'}</p>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RotateCw className="size-3.5" />
                重新加载
              </Button>
            ) : null}
          </div>
        ) : isEmpty ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
            {emptyDescription ? <p className="max-w-xs text-xs text-muted-foreground">{emptyDescription}</p> : null}
            {emptyAction}
          </div>
        ) : (
          <>
            <div ref={chartBoxRef} className="w-full">
              {children}
            </div>
            {footer ? <div className="border-t border-border/60 pt-2.5">{footer}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
