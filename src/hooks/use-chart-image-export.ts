import { useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { type ChartExportLegendItem, exportChartContainerToPng } from '@/lib/chart-export';

interface ChartExportTriggerParams {
  readonly title: string;
  readonly subtitle?: string;
  readonly filenameBase: string;
  readonly legend?: readonly ChartExportLegendItem[];
  readonly successMessage?: string;
}

/**
 * 复用图表保存图片的防重入锁、加载态与中文反馈提示，供统计分析卡片与生长发育曲线共享。
 */
export function useChartImageExport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  async function saveImage(params: ChartExportTriggerParams): Promise<void> {
    if (busyRef.current || !containerRef.current) return;
    busyRef.current = true;
    setExporting(true);
    try {
      await exportChartContainerToPng({
        container: containerRef.current,
        title: params.title,
        subtitle: params.subtitle,
        filenameBase: params.filenameBase,
        legend: params.legend,
      });
      toast.success(params.successMessage ?? '图表已保存为图片');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存图片失败，请稍后重试');
    } finally {
      busyRef.current = false;
      setExporting(false);
    }
  }

  return { containerRef, exporting, saveImage };
}
