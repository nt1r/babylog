import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Baby,
  Bath,
  CornerDownLeft,
  HeartPulse,
  type LucideIcon,
  Milk,
  MonitorIcon,
  MoonIcon,
  MoonStar,
  Pill,
  Ruler,
  Search,
  Sparkles,
  SunIcon,
  Thermometer,
  Utensils,
} from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { toast } from '@/components/ui/toast';
import { useActiveBabyId } from '@/lib/baby';
import { cn } from '@/lib/utils';
import { getVisibleNavGroups, openContextualCreate } from '@/navigation/menu';
import { useAuthStore } from '@/stores/auth';
import { useCommandPaletteStore } from '@/stores/command-palette';
import { useGrowthRecordStore } from '@/stores/growth-record';
import { usePreferencesStore } from '@/stores/preferences';
import { useQuickRecordStore } from '@/stores/quick-record';

interface CommandActionItem {
  readonly id: string;
  readonly group: '快速记录' | '页面导航' | '外观主题';
  readonly label: string;
  readonly hint?: string;
  readonly keywords: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

const GROUP_ORDER: ReadonlyArray<CommandActionItem['group']> = ['快速记录', '页面导航', '外观主题'];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"], [role="textbox"]'));
}

// 依赖 UI 原语统一的 data-slot 属性检测当前是否存在活跃弹窗、抽屉或浮层，防止全局快捷键叠开或打断提交中抽屉。
function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="drawer-popup"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"]',
    ),
  );
}

/** 判断当前操作系统是否使用 ⌘ 修饰键，供头部触发按钮与弹窗底部提示保持一致。 */
export function getShortcutModifierSymbol(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

/**
 * 全局快捷命令面板（⌘K / Ctrl+K）与轻量单键快捷记一笔（N）：
 * 支持中文与关键词实时过滤、方向键与回车直达，所有操作均复用既有路由与抽屉 Store。
 */
export function CommandPalette() {
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const toggle = useCommandPaletteStore((state) => state.toggle);

  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useAuthStore((state) => state.user);
  const activeBabyId = useActiveBabyId();
  const openQuickCreate = useQuickRecordStore((state) => state.openCreate);
  const openGrowthCreate = useGrowthRecordStore((state) => state.openCreate);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  // 监听全局快捷键：⌘K / Ctrl+K 切换命令面板（已有其他弹窗或抽屉打开时不强行叠开）；非输入态按 N 快速呼出记一笔。
  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;

      if (mod && key === 'k') {
        if (!open && hasOpenOverlay()) return;
        event.preventDefault();
        toggle();
        return;
      }

      if (!mod && !event.altKey && !event.shiftKey && key === 'n') {
        if (activeBabyId === null || isEditableTarget(event.target) || hasOpenOverlay()) return;
        event.preventDefault();
        openContextualCreate(pathname);
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [open, toggle, pathname, activeBabyId]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const allItems = useMemo<CommandActionItem[]>(() => {
    const quickItems: CommandActionItem[] = [
      {
        id: 'quick-formula',
        group: '快速记录',
        label: '记配方奶',
        hint: '喂养',
        keywords: '配方奶 奶粉 喝奶 奶量 feeding formula milk',
        icon: Milk,
        run: () => openQuickCreate('feeding', 'formula'),
      },
      {
        id: 'quick-breast',
        group: '快速记录',
        label: '记母乳喂养',
        hint: '喂养',
        keywords: '母乳 亲喂 瓶喂 feeding breast',
        icon: Milk,
        run: () => openQuickCreate('feeding', 'breast'),
      },
      {
        id: 'quick-solid',
        group: '快速记录',
        label: '记辅食',
        hint: '喂养',
        keywords: '辅食 米粉 果泥 feeding solid',
        icon: Utensils,
        run: () => openQuickCreate('feeding', 'solid'),
      },
      {
        id: 'quick-sleep',
        group: '快速记录',
        label: '记睡眠',
        hint: '小睡 / 夜觉',
        keywords: '睡眠 小睡 夜觉 睡觉 sleep nap night',
        icon: MoonStar,
        run: () => openQuickCreate('sleep'),
      },
      {
        id: 'quick-diaper',
        group: '快速记录',
        label: '记换尿布 / 便便',
        hint: '护理',
        keywords: '尿布 嘘嘘 便便 排便 care diaper poop pee',
        icon: Baby,
        run: () => openQuickCreate('care', 'diaper'),
      },
      {
        id: 'quick-bath',
        group: '快速记录',
        label: '记洗澡',
        hint: '护理',
        keywords: '洗澡 护理 care bath',
        icon: Bath,
        run: () => openQuickCreate('care', 'bath'),
      },
      {
        id: 'quick-temp',
        group: '快速记录',
        label: '记体温',
        hint: '健康',
        keywords: '体温 发烧 发热 测温 health temperature',
        icon: Thermometer,
        run: () => openQuickCreate('health', 'temperature'),
      },
      {
        id: 'quick-medicine',
        group: '快速记录',
        label: '记用药 / 补剂',
        hint: '健康',
        keywords: '用药 吃药 维生素 D3 AD 补剂 health medicine',
        icon: Pill,
        run: () => openQuickCreate('health', 'medicine'),
      },
      {
        id: 'quick-growth',
        group: '快速记录',
        label: '记生长测量',
        hint: '体重 / 身高 / 头围',
        keywords: '生长 体重 身高 头围 儿保 体检 growth weight height',
        icon: Ruler,
        run: () => openGrowthCreate('growth'),
      },
      {
        id: 'quick-teeth',
        group: '快速记录',
        label: '记乳牙萌出',
        hint: '出牙里程碑',
        keywords: '长牙 出牙 乳牙 teeth growth',
        icon: Sparkles,
        run: () => openGrowthCreate('teeth'),
      },
    ];

    const navItems: CommandActionItem[] = getVisibleNavGroups(user?.role).flatMap((group) =>
      group.items.map((item) => ({
        id: `nav-${item.id}`,
        group: '页面导航' as const,
        label: item.title,
        hint: group.label,
        keywords: `${item.title} ${item.shortTitle} ${item.id} ${group.label}`,
        icon: item.icon,
        run: () => {
          void navigate({ to: item.url });
        },
      })),
    );

    const themeItems: CommandActionItem[] = [
      {
        id: 'theme-light',
        group: '外观主题',
        label: '切换为浅色模式',
        hint: '白天温暖暖米白',
        keywords: '浅色 明亮 亮色 主题 theme light',
        icon: SunIcon,
        run: () => {
          setThemeMode('light');
          toast.success('已切换为浅色模式');
        },
      },
      {
        id: 'theme-dark',
        group: '外观主题',
        label: '切换为深色护眼模式',
        hint: '夜间喂奶不刺眼',
        keywords: '深色 暗色 夜间 护眼 主题 theme dark',
        icon: MoonIcon,
        run: () => {
          setThemeMode('dark');
          toast.success('已切换为深色护眼');
        },
      },
      {
        id: 'theme-system',
        group: '外观主题',
        label: '外观跟随系统',
        hint: '自动适配深浅色',
        keywords: '系统 自动 主题 theme system',
        icon: MonitorIcon,
        run: () => {
          setThemeMode('system');
          toast.success('已切换为跟随系统');
        },
      },
    ];

    return [...(activeBabyId !== null ? quickItems : []), ...navItems, ...themeItems];
  }, [activeBabyId, user?.role, navigate, openQuickCreate, openGrowthCreate, setThemeMode]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    const terms = q.split(/\s+/).filter(Boolean);
    return allItems.filter((item) => {
      const haystack = `${item.label} ${item.hint ?? ''} ${item.keywords}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [allItems, query]);

  const groupedItems = useMemo(() => {
    const flatIndices = new Map<string, number>();
    for (const [idx, item] of filteredItems.entries()) {
      flatIndices.set(item.id, idx);
    }
    return GROUP_ORDER.map((group) => ({
      group,
      items: filteredItems
        .filter((item) => item.group === group)
        .map((item) => ({ item, index: flatIndices.get(item.id) ?? 0 })),
    })).filter((section) => section.items.length > 0);
  }, [filteredItems]);

  const safeActiveIndex = filteredItems.length > 0 ? Math.min(activeIndex, filteredItems.length - 1) : 0;

  useEffect(() => {
    if (!open) return;
    optionRefs.current[safeActiveIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, safeActiveIndex]);

  function executeItem(item: CommandActionItem) {
    setOpen(false);
    item.run();
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // 中文/日文输入法候选词上屏回车不触发命令执行。
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (filteredItems.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filteredItems[safeActiveIndex];
      if (target) executeItem(target);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:top-[20%]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>快捷操作与页面搜索</DialogTitle>
          <DialogDescription>输入关键词快速记录宝宝日常、切换页面或更改主题。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2.5 border-b border-border/80 px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索页面、记奶量、记体温、切换主题…"
            aria-label="搜索快捷操作或页面"
            className="h-8 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80 md:text-sm"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {groupedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
              <HeartPulse className="size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">没有找到匹配的操作</p>
              <p className="text-xs text-muted-foreground">试试输入「配方奶」「疫苗」「体温」或「深色」</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {groupedItems.map((section) => (
                <div key={section.group} className="space-y-1">
                  <p className="px-2 text-xs font-medium text-muted-foreground">{section.group}</p>
                  <div role="listbox" aria-label={section.group} className="space-y-0.5">
                    {section.items.map(({ item, index }) => {
                      const Icon = item.icon;
                      const isActive = index === safeActiveIndex;
                      return (
                        <button
                          key={item.id}
                          ref={(el) => {
                            optionRefs.current[index] = el;
                          }}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => executeItem(item)}
                          className={cn(
                            'flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors outline-none',
                            isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted/60',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Icon
                              className={cn('size-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}
                              strokeWidth={1.8}
                            />
                            <span className="truncate font-medium">{item.label}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                            {item.hint ? <span>{item.hint}</span> : null}
                            {isActive ? <CornerDownLeft className="size-3.5 text-primary" aria-hidden="true" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/75 bg-muted/30 px-3.5 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>选择</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              <span>执行</span>
            </span>
          </div>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <span>随时按</span>
            <Kbd>N</Kbd>
            <span>快速记一笔</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
