import { create } from 'zustand';
import type { RecordCategory } from '@/lib/categories';
import type { ExportRangePreset } from '@/lib/export';
import type { EditableRecord, HealthRecord } from '@/lib/records';

export type QuickRecordIntent =
  | { readonly mode: 'create'; readonly category: RecordCategory; readonly initialSubtype?: string }
  | { readonly mode: 'edit'; readonly target: EditableRecord }
  | { readonly mode: 'duplicate'; readonly target: EditableRecord };

export type GrowthEntrySubtype = 'growth' | 'teeth';

export type GrowthRecordIntent =
  | { readonly mode: 'create'; readonly initialSubtype: GrowthEntrySubtype }
  | { readonly mode: 'edit'; readonly record: HealthRecord };

type GlobalOverlayId = 'quick-record' | 'growth-record' | 'batch-record' | 'export' | 'add-baby' | 'command-palette';

const BABY_SCOPED_OVERLAYS: ReadonlySet<GlobalOverlayId> = new Set([
  'quick-record',
  'growth-record',
  'batch-record',
  'export',
]);

const INITIAL_QUICK_INTENT: QuickRecordIntent = { mode: 'create', category: 'feeding' };
const INITIAL_GROWTH_INTENT: GrowthRecordIntent = { mode: 'create', initialSubtype: 'growth' };
const INITIAL_EXPORT_PRESET: ExportRangePreset = '30';

function getQuickIntentCategory(intent: QuickRecordIntent): RecordCategory {
  return intent.mode === 'create' ? intent.category : intent.target.category;
}

interface OverlayStoreState {
  active: GlobalOverlayId | null;
  locked: boolean;
  quickRecordIntent: QuickRecordIntent;
  growthRecordIntent: GrowthRecordIntent;
  exportPreset: ExportRangePreset;
  openQuickCreate: (category?: RecordCategory, initialSubtype?: string) => void;
  openQuickEdit: (target: EditableRecord) => void;
  openQuickDuplicate: (target: EditableRecord) => void;
  openGrowthCreate: (initialSubtype?: GrowthEntrySubtype) => void;
  openGrowthEdit: (record: HealthRecord) => void;
  openBatchRecord: () => void;
  openExport: (preset?: ExportRangePreset) => void;
  openAddBaby: () => void;
  openCommandPalette: () => void;
  toggleCommandPalette: () => void;
  close: (id?: GlobalOverlayId) => void;
  setLocked: (id: GlobalOverlayId, locked: boolean) => void;
  resetBabyScoped: () => void;
  resetAll: () => void;
}

/**
 * 全局浮层统一生命周期 Store，收口挂载于 AppShell 的 6 类全局抽屉/弹窗：
 * - 单一互斥槽位 active 保证全局浮层间结构性互斥，原子切换（如快捷录入切批量补录、命令面板拉起抽屉）不会叠开；
 * - 区分宝宝作用域（快捷录入、生长发育、批量补录、Excel 导出）与用户级（添加宝宝、命令面板），
 *   切娃时统一经 resetBabyScoped 清理，同时尊重进行中的锁定任务（如正在生成的导出流）；
 * - 普通手动关闭保留各抽屉上次意图以防滑出动画闪烁，切娃或退出登录时彻底清空保留意图。
 */
export const useOverlayStore = create<OverlayStoreState>((set) => ({
  active: null,
  locked: false,
  quickRecordIntent: INITIAL_QUICK_INTENT,
  growthRecordIntent: INITIAL_GROWTH_INTENT,
  exportPreset: INITIAL_EXPORT_PRESET,

  openQuickCreate: (category, initialSubtype) =>
    set((state) => {
      if (state.locked) return state;
      return {
        active: 'quick-record',
        quickRecordIntent: {
          mode: 'create',
          category: category ?? getQuickIntentCategory(state.quickRecordIntent),
          initialSubtype,
        },
      };
    }),

  openQuickEdit: (target) =>
    set((state) => {
      if (state.locked) return state;
      return {
        active: 'quick-record',
        quickRecordIntent: { mode: 'edit', target },
      };
    }),

  openQuickDuplicate: (target) =>
    set((state) => {
      if (state.locked) return state;
      return {
        active: 'quick-record',
        quickRecordIntent: { mode: 'duplicate', target },
      };
    }),

  openGrowthCreate: (initialSubtype = 'growth') =>
    set((state) => {
      if (state.locked) return state;
      return {
        active: 'growth-record',
        growthRecordIntent: { mode: 'create', initialSubtype },
      };
    }),

  openGrowthEdit: (record) =>
    set((state) => {
      if (state.locked) return state;
      return {
        active: 'growth-record',
        growthRecordIntent: { mode: 'edit', record },
      };
    }),

  openBatchRecord: () =>
    set((state) => {
      if (state.locked) return state;
      return { active: 'batch-record' };
    }),

  openExport: (preset = INITIAL_EXPORT_PRESET) =>
    set((state) => {
      if (state.locked) return state;
      return {
        active: 'export',
        exportPreset: preset,
      };
    }),

  openAddBaby: () =>
    set((state) => {
      if (state.locked) return state;
      return { active: 'add-baby' };
    }),

  openCommandPalette: () =>
    set((state) => {
      if (state.locked) return state;
      return { active: 'command-palette' };
    }),

  toggleCommandPalette: () =>
    set((state) => {
      if (state.locked) return state;
      return { active: state.active === 'command-palette' ? null : 'command-palette' };
    }),

  // 仅当目标浮层仍是当前活跃槽位且未加锁时关闭，防止原子切换后的退场回调误关新浮层；
  // 保留 quickRecordIntent / growthRecordIntent / exportPreset 以避免抽屉滑出动画期间闪烁。
  close: (id) =>
    set((state) => {
      if (state.active === null || state.locked) return state;
      if (id !== undefined && state.active !== id) return state;
      return { active: null };
    }),

  setLocked: (id, locked) =>
    set((state) => {
      if (state.active !== id || state.locked === locked) return state;
      return { locked };
    }),

  // 切换当前宝宝时统一收口所有 baby-scoped 浮层与保留意图；
  // 若某 baby-scoped 浮层正处于进行中锁定态（如 Excel 导出请求未完成），保留其打开态与当前预设，避免打断下载流。
  resetBabyScoped: () =>
    set((state) => {
      const isBabyScopedActive = state.active !== null && BABY_SCOPED_OVERLAYS.has(state.active);
      if (isBabyScopedActive && state.locked) {
        return {
          quickRecordIntent: state.active === 'quick-record' ? state.quickRecordIntent : INITIAL_QUICK_INTENT,
          growthRecordIntent: state.active === 'growth-record' ? state.growthRecordIntent : INITIAL_GROWTH_INTENT,
          exportPreset: state.active === 'export' ? state.exportPreset : INITIAL_EXPORT_PRESET,
        };
      }
      return {
        active: isBabyScopedActive ? null : state.active,
        quickRecordIntent: INITIAL_QUICK_INTENT,
        growthRecordIntent: INITIAL_GROWTH_INTENT,
        exportPreset: INITIAL_EXPORT_PRESET,
      };
    }),

  // 退出登录、401 会话失效或切换账号时无条件强清全部浮层、锁与保留意图，阻断跨用户残留。
  resetAll: () =>
    set({
      active: null,
      locked: false,
      quickRecordIntent: INITIAL_QUICK_INTENT,
      growthRecordIntent: INITIAL_GROWTH_INTENT,
      exportPreset: INITIAL_EXPORT_PRESET,
    }),
}));
