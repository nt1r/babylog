import type { LucideIcon } from 'lucide-react';
import { BellRing, LayoutDashboard, Settings2, Syringe } from 'lucide-react';
import { RECORD_CATEGORIES, RECORD_CATEGORY_META, type RecordCategory } from '@/lib/categories';

export interface NavItem {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly url: '/dashboard' | '/vaccines' | '/feeding' | '/sleep' | '/care' | '/health' | '/reminders' | '/settings';
  readonly icon: LucideIcon;
  readonly category?: RecordCategory;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

const DAILY_NAV_ITEMS: readonly NavItem[] = RECORD_CATEGORIES.map((category) => {
  const meta = RECORD_CATEGORY_META[category];
  return {
    id: meta.id,
    title: meta.pageTitle,
    shortTitle: meta.shortLabel,
    url: meta.url,
    icon: meta.icon,
    category: meta.id,
  };
});

export const NAV_GROUPS: readonly NavGroup[] = [
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
    ],
  },
  {
    id: 'daily',
    label: '日常记录',
    items: DAILY_NAV_ITEMS,
  },
  {
    id: 'plans',
    label: '成长计划',
    items: [
      {
        id: 'vaccines',
        title: '疫苗接种',
        shortTitle: '疫苗',
        url: '/vaccines',
        icon: Syringe,
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

export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

// 移动端底部导航保留最高频的 4 个入口（搭配中央快速记一笔）
const MOBILE_NAV_IDS = new Set(['dashboard', 'feeding', 'sleep', 'care']);
export const MOBILE_NAV_ITEMS: readonly NavItem[] = ALL_NAV_ITEMS.filter((item) => MOBILE_NAV_IDS.has(item.id));

export function findNavItemByPath(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS, ...HIDDEN_NAV_ITEMS].find(
    (item) => pathname === item.url || pathname.startsWith(`${item.url}/`),
  );
}
