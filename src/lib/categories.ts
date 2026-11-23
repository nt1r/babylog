import { Baby, HeartPulse, type LucideIcon, Milk, MoonStar } from 'lucide-react';

/**
 * 宝宝日常记录的统一分类标识与元数据注册表，
 * 作为导航菜单、首页看板、快捷录入抽屉与四类列表页的单一事实来源。
 */
export type RecordCategory = 'feeding' | 'sleep' | 'care' | 'health';

export const RECORD_CATEGORIES: readonly RecordCategory[] = ['feeding', 'sleep', 'care', 'health'];

export interface RecordCategoryMeta {
  readonly id: RecordCategory;
  readonly shortLabel: string;
  readonly pageTitle: string;
  readonly createLabel: string;
  readonly url: '/feeding' | '/sleep' | '/care' | '/health';
  readonly icon: LucideIcon;
  readonly softClass: string;
  readonly activeClass: string;
  readonly quickCardClass: string;
}

export const RECORD_CATEGORY_META: Record<RecordCategory, RecordCategoryMeta> = {
  feeding: {
    id: 'feeding',
    shortLabel: '喂养',
    pageTitle: '喂养记录',
    createLabel: '记一笔喂养',
    url: '/feeding',
    icon: Milk,
    softClass: 'bg-feeding-soft text-feeding-soft-foreground',
    activeClass: 'border-feeding bg-feeding-soft text-feeding-soft-foreground',
    quickCardClass: 'bg-feeding-soft/45 hover:border-feeding',
  },
  sleep: {
    id: 'sleep',
    shortLabel: '睡眠',
    pageTitle: '睡眠记录',
    createLabel: '记一笔睡眠',
    url: '/sleep',
    icon: MoonStar,
    softClass: 'bg-sleep-soft text-sleep-soft-foreground',
    activeClass: 'border-sleep bg-sleep-soft text-sleep-soft-foreground',
    quickCardClass: 'bg-sleep-soft/45 hover:border-sleep',
  },
  care: {
    id: 'care',
    shortLabel: '护理',
    pageTitle: '日常护理',
    createLabel: '记一笔护理',
    url: '/care',
    icon: Baby,
    softClass: 'bg-care-soft text-care-soft-foreground',
    activeClass: 'border-care bg-care-soft text-care-soft-foreground',
    quickCardClass: 'bg-care-soft/45 hover:border-care',
  },
  health: {
    id: 'health',
    shortLabel: '健康',
    pageTitle: '健康与生长',
    createLabel: '记一笔健康',
    url: '/health',
    icon: HeartPulse,
    softClass: 'bg-health-soft text-health-soft-foreground',
    activeClass: 'border-health bg-health-soft text-health-soft-foreground',
    quickCardClass: 'bg-health-soft/45 hover:border-health',
  },
};

export const FEEDING_SUBTYPE_LABELS = {
  formula: '配方奶',
  breast: '母乳',
  solid: '辅食',
} as const;

export const FEEDING_SUBTYPE_OPTIONS = [
  { value: 'formula', label: FEEDING_SUBTYPE_LABELS.formula },
  { value: 'breast', label: FEEDING_SUBTYPE_LABELS.breast },
  { value: 'solid', label: FEEDING_SUBTYPE_LABELS.solid },
] as const;

export const SLEEP_SUBTYPE_LABELS = {
  nap: '白天小睡',
  night: '夜间整觉',
} as const;

export const SLEEP_SUBTYPE_OPTIONS = [
  { value: 'nap', label: SLEEP_SUBTYPE_LABELS.nap },
  { value: 'night', label: SLEEP_SUBTYPE_LABELS.night },
] as const;

export const CARE_SUBTYPE_LABELS = {
  diaper: '排便与尿布',
  bath: '洗澡',
  other: '其他护理',
} as const;

export const CARE_SUBTYPE_OPTIONS = [
  { value: 'diaper', label: CARE_SUBTYPE_LABELS.diaper },
  { value: 'bath', label: CARE_SUBTYPE_LABELS.bath },
  { value: 'other', label: CARE_SUBTYPE_LABELS.other },
] as const;

export const HEALTH_SUBTYPE_LABELS = {
  temperature: '体温',
  medicine: '用药',
  growth: '生长',
  teeth: '长牙',
} as const;

export const HEALTH_SUBTYPE_OPTIONS = [
  { value: 'temperature', label: HEALTH_SUBTYPE_LABELS.temperature },
  { value: 'medicine', label: HEALTH_SUBTYPE_LABELS.medicine },
  { value: 'growth', label: HEALTH_SUBTYPE_LABELS.growth },
  { value: 'teeth', label: HEALTH_SUBTYPE_LABELS.teeth },
] as const;
