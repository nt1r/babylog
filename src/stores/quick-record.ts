import { create } from 'zustand';
import type { RecordCategory } from '@/lib/categories';
import type { EditableRecord } from '@/lib/records';

export type QuickRecordIntent =
  | { readonly mode: 'create'; readonly category: RecordCategory; readonly initialSubtype?: string }
  | { readonly mode: 'edit'; readonly target: EditableRecord }
  | { readonly mode: 'duplicate'; readonly target: EditableRecord };

function getIntentCategory(intent: QuickRecordIntent): RecordCategory {
  return intent.mode === 'create' ? intent.category : intent.target.category;
}

interface QuickRecordStoreState {
  open: boolean;
  intent: QuickRecordIntent;
  openCreate: (category?: RecordCategory, initialSubtype?: string) => void;
  openEdit: (target: EditableRecord) => void;
  openDuplicate: (target: EditableRecord) => void;
  setOpen: (open: boolean) => void;
}

export const useQuickRecordStore = create<QuickRecordStoreState>((set) => ({
  open: false,
  intent: { mode: 'create', category: 'feeding' },

  openCreate: (category, initialSubtype) =>
    set((state) => ({
      open: true,
      intent: {
        mode: 'create',
        category: category ?? getIntentCategory(state.intent),
        initialSubtype,
      },
    })),

  openEdit: (target) =>
    set({
      open: true,
      intent: { mode: 'edit', target },
    }),

  openDuplicate: (target) =>
    set({
      open: true,
      intent: { mode: 'duplicate', target },
    }),

  // 关闭时保留当前 intent，避免抽屉滑出动画期间标题与分类栏闪烁跳回新建态；
  // 下次打开会由 openCreate/openEdit/openDuplicate 写入新的意图。
  setOpen: (open) => set({ open }),
}));
