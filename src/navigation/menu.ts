import type { LucideIcon } from 'lucide-react';
import { BellRing, LayoutDashboard, Ruler, Settings2, Syringe } from 'lucide-react';
import { RECORD_CATEGORY_META, type RecordCategory } from '@/lib/categories';

interface NavItem {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly url:
    | '/dashboard'
    | '/vaccines'
    | '/feeding'
    | '/sleep'
    | '/care'
    | '/health'
    | '/growth'
    | '/reminders'
    | '/settings';
  readonly icon: LucideIcon;
  readonly category?: RecordCategory;
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

// 移动端底部导航保留最高频的 4 个入口（搭配中央快速记一笔）
const MOBILE_NAV_IDS = new Set(['dashboard', 'feeding', 'sleep', 'care']);
export const MOBILE_NAV_ITEMS: readonly NavItem[] = ALL_NAV_ITEMS.filter((item) => MOBILE_NAV_IDS.has(item.id));

export function findNavItemByPath(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS, ...HIDDEN_NAV_ITEMS].find(
    (item) => pathname === item.url || pathname.startsWith(`${item.url}/`),
  );
}
