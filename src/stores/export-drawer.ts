import { create } from 'zustand';
import type { ExportRangePreset } from '@/lib/export';

interface ExportDrawerState {
  open: boolean;
  initialPreset: ExportRangePreset;
  openExport: (preset?: ExportRangePreset) => void;
  close: () => void;
  reset: () => void;
}

/** 驱动常驻 AppShell 中的数据导出抽屉（支持从统计分析页或命令面板安全拉起）。 */
export const useExportDrawerStore = create<ExportDrawerState>((set) => ({
  open: false,
  initialPreset: '30',
  openExport: (preset = '30') => set({ open: true, initialPreset: preset }),
  close: () => set({ open: false }),
  reset: () => set({ open: false, initialPreset: '30' }),
}));
