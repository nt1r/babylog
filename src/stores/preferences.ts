import { create } from 'zustand';
import type { RecordCategory } from '@/lib/categories';
import type { EditableRecord } from '@/lib/records';
import { DARK_THEME_COLOR, LIGHT_THEME_COLOR, THEME_STORAGE_KEY } from '@/scripts/theme-boot-script';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface QuickRecordOpenOptions {
  readonly mode?: 'create' | 'edit' | 'duplicate';
  readonly record?: EditableRecord;
  readonly initialSubtype?: string;
}

function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // 忽略隐私模式或禁用本地存储时的读取异常
  }
  return 'system';
}

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeToDom(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveThemeMode(mode);
  if (typeof document === 'undefined') return resolved;

  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', mode);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  }

  return resolved;
}

interface PreferencesState {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  quickRecordOpen: boolean;
  quickRecordCategory: RecordCategory;
  quickRecordMode: 'create' | 'edit' | 'duplicate';
  quickRecordEditing: EditableRecord | null;
  quickRecordInitialSubtype: string | null;
  setThemeMode: (mode: ThemeMode) => void;
  syncSystemTheme: () => void;
  openQuickRecord: (category?: RecordCategory, options?: QuickRecordOpenOptions) => void;
  setQuickRecordOpen: (open: boolean) => void;
}

const initialMode = readStoredThemeMode();

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  themeMode: initialMode,
  resolvedTheme: resolveThemeMode(initialMode),
  quickRecordOpen: false,
  quickRecordCategory: 'feeding',
  quickRecordMode: 'create',
  quickRecordEditing: null,
  quickRecordInitialSubtype: null,

  setThemeMode: (mode) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // 忽略本地存储写入异常，保持内存态切换可用
    }
    const resolvedTheme = applyThemeToDom(mode);
    set({ themeMode: mode, resolvedTheme });
  },

  syncSystemTheme: () => {
    const mode = get().themeMode;
    if (mode !== 'system') return;
    const resolvedTheme = applyThemeToDom('system');
    set({ resolvedTheme });
  },

  openQuickRecord: (category, options) =>
    set((state) => ({
      quickRecordOpen: true,
      quickRecordCategory: options?.record?.category ?? category ?? state.quickRecordCategory,
      quickRecordMode: options?.mode ?? 'create',
      quickRecordEditing: options?.record ?? null,
      quickRecordInitialSubtype: options?.initialSubtype ?? null,
    })),

  setQuickRecordOpen: (open) =>
    set((state) => ({
      quickRecordOpen: open,
      quickRecordMode: open ? state.quickRecordMode : 'create',
      quickRecordEditing: open ? state.quickRecordEditing : null,
      quickRecordInitialSubtype: open ? state.quickRecordInitialSubtype : null,
    })),
}));
