import { create } from 'zustand';

interface BatchRecordStoreState {
  open: boolean;
  openBatch: () => void;
  setOpen: (open: boolean) => void;
  reset: () => void;
}

/** 批量补录抽屉全局状态 Store，供看板、列表页、快捷录入抽屉与命令面板统一呼出。 */
export const useBatchRecordStore = create<BatchRecordStoreState>((set) => ({
  open: false,
  openBatch: () => set({ open: true }),
  setOpen: (open) => set({ open }),
  reset: () => set({ open: false }),
}));
