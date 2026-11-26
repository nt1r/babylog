import type { LucideIcon } from 'lucide-react';
import { BarChart3, BellRing, LayoutDashboard, Ruler, Settings2, Syringe, Users } from 'lucide-react';
import type { UserRole } from '@/lib/auth';
import { RECORD_CATEGORY_META, type RecordCategory } from '@/lib/categories';
import { useGrowthRecordStore } from '@/stores/growth-record';
import { useQuickRecordStore } from '@/stores/quick-record';

interface NavItem {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly url:
    | '/dashboard'
    | '/insights'
    | '/vaccines'
    | '/feeding'
    | '/sleep'
    | '/care'
    | '/health'
    | '/growth'
    | '/reminders'
    | '/settings'
    | '/admin/users';
  readonly icon: LucideIcon;
  readonly category?: RecordCategory;
  readonly adminOnly?: boolean;
}

interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

function navItemFromCategory(category: RecordCategory): NavItem {
  const meta = RECORD_CATEGORY_META[category];
  return {
    id: meta.id,
    title: meta.pageTitle,
    shortTitle: meta.shortLabel,
    url: meta.url,
    icon: meta.icon,
    category: meta.id,
  };
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'overview',
    label: '成长概览',
    items: [
      {
        id: 'dashboard',
        title: '首页看板',
        shortTitle: '看板',
        url: '/dashboard',
        icon: LayoutDashboard,
      },
      {
        id: 'insights',
        title: '统计分析',
        shortTitle: '统计',
        url: '/insights',
        icon: BarChart3,
      },
    ],
  },
  {
    id: 'daily',
    label: '日常照护',
    items: [navItemFromCategory('feeding'), navItemFromCategory('sleep'), navItemFromCategory('care')],
  },
  {
    id: 'health_growth',
    label: '健康与成长',
    items: [
      navItemFromCategory('health'),
      {
        id: 'vaccines',
        title: '疫苗接种',
        shortTitle: '疫苗',
        url: '/vaccines',
        icon: Syringe,
      },
      {
        id: 'growth',
        title: '生长发育',
        shortTitle: '生长',
        url: '/growth',
        icon: Ruler,
      },
    ],
  },
  {
    id: 'family',
    label: '设置',
    items: [
      {
        id: 'settings',
        title: '偏好与账号',
        shortTitle: '设置',
        url: '/settings',
        icon: Settings2,
      },
      {
        id: 'admin-users',
        title: '用户管理',
        shortTitle: '用户',
        url: '/admin/users',
        icon: Users,
        adminOnly: true,
      },
    ],
  },
] as const;

// 尚未在主导航中露出的保留路由元数据，确保直接访问时页面标题与面包屑一致。
const HIDDEN_NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'reminders',
    title: '提醒待办',
    shortTitle: '提醒',
    url: '/reminders',
    icon: BellRing,
  },
];

const ALL_NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

const MOBILE_NAV_IDS = new Set(['dashboard', 'feeding', 'sleep', 'care']);

/** 移动端底部导航栏展示的 4 个高频核心入口（搭配中央快速记一笔按钮）。 */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = ALL_NAV_ITEMS.filter((item) => MOBILE_NAV_IDS.has(item.id));

/** 按当前账号角色过滤可见导航分组（普通用户隐藏仅管理员可见的用户管理入口）。 */
export function getVisibleNavGroups(role: UserRole | undefined): readonly NavGroup[] {
  const isAdmin = role === 'admin';
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || isAdmin),
  })).filter((group) => group.items.length > 0);
}

/** 判断路径是否属于账号级路由（无宝宝档案时也允许访问，不触发首次建档重定向）。 */
export function isAccountLevelRoute(pathname: string): boolean {
  return (
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/admin/users' ||
    pathname.startsWith('/admin/users/')
  );
}

/** 按路径精确或前缀匹配导航元数据（同时覆盖 HIDDEN_NAV_ITEMS 中的保留路由）。 */
export function findNavItemByPath(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS, ...HIDDEN_NAV_ITEMS].find(
    (item) => pathname === item.url || pathname.startsWith(`${item.url}/`),
  );
}

type ContextualCreateTarget =
  | { readonly target: 'growth'; readonly ariaLabel: string }
  | {
      readonly target: 'quick';
      readonly category: RecordCategory;
      readonly subtype?: string;
      readonly ariaLabel: string;
    };

function resolveContextualCreateTarget(pathname: string): ContextualCreateTarget {
  const current = findNavItemByPath(pathname);
  if (current?.id === 'growth') {
    return { target: 'growth', ariaLabel: '记录生长发育' };
  }
  if (current?.id === 'vaccines') {
    return { target: 'quick', category: 'health', subtype: 'temperature', ariaLabel: '记录接种后体温' };
  }
  return { target: 'quick', category: current?.category ?? 'feeding', ariaLabel: '快速记一笔' };
}

/** 返回当前路由上下文对应的「快速记一笔」无障碍标签。 */
export function getContextualCreateAriaLabel(pathname: string): string {
  return resolveContextualCreateTarget(pathname).ariaLabel;
}

/**
 * 按当前路由上下文直接打开对应录入抽屉（生长发育抽屉或日常快捷录入抽屉），
 * 向应用外壳隐藏双 Store 派发分支，避免头部、底部栏与快捷键三处重复判断。
 */
export function openContextualCreate(pathname: string): void {
  const action = resolveContextualCreateTarget(pathname);
  if (action.target === 'growth') {
    useGrowthRecordStore.getState().openCreate('growth');
    return;
  }
  useQuickRecordStore.getState().openCreate(action.category, action.subtype);
}
