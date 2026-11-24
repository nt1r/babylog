import { create } from 'zustand';
import type { HealthRecord } from '@/lib/records';

export type GrowthEntrySubtype = 'growth' | 'teeth';

export type GrowthRecordIntent =
  | { readonly mode: 'create'; readonly initialSubtype: GrowthEntrySubtype }
  | { readonly mode: 'edit'; readonly record: HealthRecord };

interface GrowthRecordStoreState {
  open: boolean;
  intent: GrowthRecordIntent;
  openCreate: (initialSubtype?: GrowthEntrySubtype) => void;
  openEdit: (record: HealthRecord) => void;
  setOpen: (open: boolean) => void;
}

/** 生长发育专属录入抽屉（体格测量 / 长牙）的全局打开状态与意图管理。 */
export const useGrowthRecordStore = create<GrowthRecordStoreState>((set) => ({
  open: false,
  intent: { mode: 'create', initialSubtype: 'growth' },

  openCreate: (initialSubtype = 'growth') =>
    set({
      open: true,
      intent: { mode: 'create', initialSubtype },
    }),

  openEdit: (record) =>
    set({
      open: true,
      intent: { mode: 'edit', record },
    }),

  // 关闭动画期间保持当前 intent 稳定，由下次打开动作覆盖，避免抽屉滑出瞬间内容闪烁。
  setOpen: (open) => set({ open }),
}));
