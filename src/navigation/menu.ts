import type { LucideIcon } from 'lucide-react';
import { Baby, BellRing, HeartPulse, LayoutDashboard, Milk, MoonStar, Settings2 } from 'lucide-react';
import type { RecordCategory } from '@/lib/categories';

export interface NavItem {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly url: '/dashboard' | '/feeding' | '/sleep' | '/care' | '/health' | '/reminders' | '/settings';
  readonly icon: LucideIcon;
  readonly description: string;
  readonly category?: RecordCategory;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
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
        description: '每日喂养、睡眠、护理与提醒汇总',
      },
    ],
  },
  {
    id: 'daily',
    label: '每日高频',
    items: [
      {
        id: 'feeding',
        title: '喂养记录',
        shortTitle: '喂养',
        url: '/feeding',
        icon: Milk,
        description: '母乳、配方奶与辅食时间、奶量追踪',
        category: 'feeding',
      },
      {
        id: 'sleep',
        title: '睡眠记录',
        shortTitle: '睡眠',
        url: '/sleep',
        icon: MoonStar,
        description: '白天小睡与夜间整觉时长统计',
        category: 'sleep',
      },
      {
        id: 'care',
        title: '日常护理',
        shortTitle: '护理',
        url: '/care',
        icon: Baby,
        description: '大小便、换尿布与洗澡等日常照护',
        category: 'care',
      },
    ],
  },
  {
    id: 'growth',
    label: '成长与计划',
    items: [
      {
        id: 'health',
        title: '健康与生长',
        shortTitle: '健康',
        url: '/health',
        icon: HeartPulse,
        description: '体温、用药、身高体重与长牙档案',
        category: 'health',
      },
      {
        id: 'reminders',
        title: '提醒待办',
        shortTitle: '提醒',
        url: '/reminders',
        icon: BellRing,
        description: '疫苗接种、定时用药与儿保日程',
        category: 'reminder',
      },
    ],
  },
  {
    id: 'family',
    label: '空间设置',
    items: [
      {
        id: 'settings',
        title: '偏好与账号',
        shortTitle: '设置',
        url: '/settings',
        icon: Settings2,
        description: '外观主题、夜间模式与当前账号状态',
      },
    ],
  },
] as const;

export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

// 移动端底部导航保留最高频的 4 个入口（搭配中央快速记一笔）
const MOBILE_NAV_IDS = new Set(['dashboard', 'feeding', 'sleep', 'care']);
export const MOBILE_NAV_ITEMS: readonly NavItem[] = ALL_NAV_ITEMS.filter((item) => MOBILE_NAV_IDS.has(item.id));

export function findNavItemByPath(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => pathname === item.url || pathname.startsWith(`${item.url}/`));
}
