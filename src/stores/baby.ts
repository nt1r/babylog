import { create } from 'zustand';
import { useGrowthRecordStore } from '@/stores/growth-record';
import { useQuickRecordStore } from '@/stores/quick-record';

const STORAGE_KEY_PREFIX = 'babylog:active-baby:';

function storageKeyForUser(userId: number): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function readPersistedActiveBabyId(userId: number | null): number | null {
  if (userId === null || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKeyForUser(userId));
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writePersistedActiveBabyId(userId: number | null, babyId: number | null): void {
  if (userId === null || typeof window === 'undefined') return;
  try {
    const key = storageKeyForUser(userId);
    if (babyId === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(babyId));
    }
  } catch {
    // 隐私模式或存储受限时忽略持久化错误，内存态仍正常工作。
  }
}

/** 按「当前内存态 → 按 userId 持久化的 ID → 列表首位」优先级解析当前有效宝宝 ID。 */
function resolveActiveBabyId(
  babies: ReadonlyArray<{ readonly id: number }>,
  currentId: number | null,
  persistedId: number | null,
): number | null {
  if (babies.length === 0) return null;
  if (currentId !== null && babies.some((b) => b.id === currentId)) {
    return currentId;
  }
  if (persistedId !== null && babies.some((b) => b.id === persistedId)) {
    return persistedId;
  }
  return babies[0]?.id ?? null;
}

interface BabyStoreState {
  activeBabyId: number | null;
  syncedUserId: number | null;
  addDialogOpen: boolean;
  setActiveBabyId: (userId: number | null, babyId: number | null) => void;
  setAddDialogOpen: (open: boolean) => void;
  syncActiveBaby: (userId: number, babies: ReadonlyArray<{ readonly id: number }>) => number | null;
  reset: () => void;
}

/** 当前选中宝宝状态 Store，按 userId 命名空间隔离本地持久化，并在切娃时重置全局录入抽屉。 */
export const useBabyStore = create<BabyStoreState>((set, get) => ({
  activeBabyId: null,
  syncedUserId: null,
  addDialogOpen: false,

  setActiveBabyId: (userId, babyId) => {
    const prev = get().activeBabyId;
    if (prev !== babyId) {
      // 切换宝宝时关闭并重置快捷记录与生长发育抽屉，避免把前一个宝宝的编辑/复用目标带入新宝宝。
      useQuickRecordStore.getState().reset();
      useGrowthRecordStore.getState().reset();
    }
    writePersistedActiveBabyId(userId, babyId);
    set({ activeBabyId: babyId, syncedUserId: userId });
  },

  setAddDialogOpen: (open) => set({ addDialogOpen: open }),

  syncActiveBaby: (userId, babies) => {
    const state = get();
    const prev = state.activeBabyId;
    const persisted = readPersistedActiveBabyId(userId);
    const next = resolveActiveBabyId(babies, prev, persisted);
    if (prev !== next || state.syncedUserId !== userId) {
      if (prev !== null && prev !== next) {
        useQuickRecordStore.getState().reset();
        useGrowthRecordStore.getState().reset();
      }
      set({ activeBabyId: next, syncedUserId: userId });
    }
    if (next !== persisted) {
      writePersistedActiveBabyId(userId, next);
    }
    return next;
  },

  reset: () => set({ activeBabyId: null, syncedUserId: null, addDialogOpen: false }),
}));
