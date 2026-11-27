import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Baby, Bath, Droplets, type LucideIcon, Milk } from 'lucide-react';
import { babyApiRequest, dashboardSummaryQueryOptions, useBabyQuery } from '@/lib/baby-api';
import { RECORD_CATEGORY_META, type RecordCategoryMeta } from '@/lib/categories';
import type { GrowthSummary } from '@/lib/growth';
import type { OneTapRecordAction } from '@/lib/one-tap-record';
import { babyDashboardQueryKey } from '@/lib/query-client';
import {
  BREAST_SIDE_LABELS,
  type CareDailySummary,
  FEEDING_DEFAULTS,
  type FeedingDailySummary,
  getTemperatureSeverity,
  type SaveRecordRequest,
  type SleepDailySummary,
  type SmartDefaults,
} from '@/lib/records';
import { formatDurationMin, formatShortCnDate, formatTimeSince, parseLocalDateKey } from '@/lib/time';
import {
  formatDaysUntilLabel,
  formatDoseShortTitle,
  getAlertBadgeMeta,
  type VaccineOverviewResponse,
} from '@/lib/vaccines';

interface DashboardSummary {
  date: string;
  feeding: FeedingDailySummary & {
    last_feeding_at: string | null;
  };
  sleep: SleepDailySummary;
  health: {
    latest_temp_c: number | null;
    latest_temp_at: string | null;
    today_medicine_count: number;
    latest_medicine_name: string | null;
    latest_medicine_at: string | null;
  };
  growth: GrowthSummary;
  care: CareDailySummary & {
    last_diaper_at: string | null;
  };
}

export interface DashboardTrends {
  daily: Array<{
    date: string;
    label: string;
    feeding_ml: number;
    formula_ml: number;
    formula_count: number;
    bottle_breast_ml: number;
    bottle_breast_count: number;
    direct_breast_min: number;
    direct_breast_count: number;
    solid_count: number;
    feeding_count: number;
    sleep_hours: number;
    nap_hours: number;
    night_hours: number;
    nap_count: number;
    pee_count: number;
    poop_count: number;
    bath_count: number;
    max_temp_c: number | null;
    medicine_count: number;
  }>;
  slots: Array<{
    slot: string;
    count: number;
  }>;
  period_summary: {
    active_days: {
      feeding_days: number;
      sleep_days: number;
      care_days: number;
    };
    breast_side: {
      left_count: number;
      right_count: number;
      both_count: number;
    };
    solid_acceptance: {
      like_count: number;
      neutral_count: number;
      dislike_count: number;
    };
    sleep: {
      longest_night_min: number;
      avg_nap_min: number;
    };
    stool: {
      total_poop_count: number;
      watery_count: number;
      hard_count: number;
      abnormal_color_count: number;
    };
  };
}

export type DashboardTrendTab = 'feeding' | 'sleep';

interface DashboardTrendView {
  readonly daily: DashboardTrends['daily'];
  readonly isDirectBreastMode: boolean;
  readonly hasCurrentTrendData: boolean;
  readonly dataKey: 'feeding_ml' | 'direct_breast_min' | 'sleep_hours';
  readonly description: string;
  readonly hasSlotData: boolean;
}

interface DashboardKpiCard {
  readonly id: RecordCategoryMeta['id'];
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly iconClass: string;
  readonly icon: RecordCategoryMeta['icon'];
  readonly to: RecordCategoryMeta['url'];
  readonly alertTone: 'warning' | 'destructive' | null;
}

export interface DashboardVaccineAlertBanner {
  readonly kind: 'birth_confirm' | 'scheduled_overdue' | 'overdue' | 'scheduled_soon' | 'due_soon';
  readonly badgeLabel: string;
  readonly badgeVariant: 'warning' | 'destructive' | 'info' | 'secondary';
  readonly tone: 'primary' | 'info' | 'warning' | 'destructive';
  readonly title: string;
  readonly detail: string;
  readonly countdown?: string;
}

export interface PostVaccineTempCue {
  readonly doseNames: readonly string[];
}

interface DashboardVaccineCardFocus {
  readonly showBirthConfirm: boolean;
  readonly birthPendingDoses: readonly VaccineOverviewResponse['doses'][number][];
  readonly focusDoses: readonly VaccineOverviewResponse['doses'][number][];
  readonly nipPercent: number;
}

const HEALTH_RECENT_TEMP_WINDOW_MS = 48 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 纯函数推导近 N 日趋势图的展示模式（纯亲喂分钟数 vs 奶量 ml vs 睡眠小时）与空态判定。
 */
export function selectTrendView(trends: DashboardTrends | undefined, tab: DashboardTrendTab): DashboardTrendView {
  const daily = trends?.daily ?? [];
  const hasBottleMilkTrend = daily.some((item) => item.feeding_ml > 0);
  const hasDirectBreastTrend = daily.some((item) => item.direct_breast_min > 0);
  const isDirectBreastMode = !hasBottleMilkTrend && hasDirectBreastTrend;
  const hasSleepTrend = daily.some((item) => item.sleep_hours > 0);
  const hasCurrentTrendData = tab === 'sleep' ? hasSleepTrend : hasBottleMilkTrend || hasDirectBreastTrend;
  const dataKey = tab === 'sleep' ? 'sleep_hours' : isDirectBreastMode ? 'direct_breast_min' : 'feeding_ml';
  const description =
    tab === 'sleep' ? '每日睡眠时长（小时）' : isDirectBreastMode ? '每日亲喂时长（分钟）' : '每日奶量（ml）';
  const hasSlotData = (trends?.slots ?? []).some((item) => item.count > 0);

  return {
    daily,
    isDirectBreastMode,
    hasCurrentTrendData,
    dataKey,
    description,
    hasSlotData,
  };
}

/**
 * 判断某 ISO 体温时间戳是否落在距今指定观测窗口内。
 * 下限允许 -5 分钟（与后端写接口允许 +5 分钟客户端时钟漂移保持一致），避免刚保存记录因轻微时钟差落出窗口。
 */
function isWithinHours(isoStr: string | null, now: Date, windowMs: number): boolean {
  if (!isoStr) return false;
  const parsed = parseISO(isoStr);
  if (Number.isNaN(parsed.getTime())) return false;
  const diff = now.getTime() - parsed.getTime();
  return diff <= windowMs && diff >= -CLOCK_SKEW_TOLERANCE_MS;
}

/**
 * 纯函数将今日汇总 KPI 转换为首页 4 张指标卡片（顺序对齐侧栏：喂养 / 睡眠 / 护理 / 健康观察）。
 * 健康观察优先级：近 48h 体温（发热自动预警色）→ 今日用药 → 历史体温（中性展示）→ 空态。
 */
export function buildDashboardKpiCards(summary: DashboardSummary | undefined, now: Date): DashboardKpiCard[] {
  const feedingValue = summary
    ? summary.feeding.total_ml > 0
      ? `${summary.feeding.total_ml} ml`
      : summary.feeding.direct_breast_count > 0
        ? `亲喂 ${summary.feeding.direct_breast_count} 次`
        : '0 ml'
    : '—';

  const feedingSub = summary
    ? summary.feeding.last_feeding_at
      ? `距上次 ${formatTimeSince(summary.feeding.last_feeding_at, now)} · 今日 ${summary.feeding.total_count} 次`
      : '今日还没有记录'
    : '今日喂养汇总';

  const sleepValue = summary ? formatDurationMin(summary.sleep.total_min) : '—';
  const sleepSub = summary
    ? `小睡 ${summary.sleep.nap_count} 次 · 夜觉 ${formatDurationMin(summary.sleep.night_min)}`
    : '今日睡眠汇总';

  const careValue = summary ? `${summary.care.total_count} 次` : '—';
  const careSub = summary
    ? summary.care.last_diaper_at
      ? `嘘嘘 ${summary.care.pee_count} · 便便 ${summary.care.poop_count} · 上次 ${formatTimeSince(summary.care.last_diaper_at, now)}`
      : `嘘嘘 ${summary.care.pee_count} · 便便 ${summary.care.poop_count}`
    : '今日护理汇总';

  const latestTemp = summary?.health.latest_temp_c ?? null;
  const latestTempAt = summary?.health.latest_temp_at ?? null;
  const tempSeverity = latestTemp !== null ? getTemperatureSeverity(latestTemp) : null;
  const isTempRecent = isWithinHours(latestTempAt, now, HEALTH_RECENT_TEMP_WINDOW_MS);
  const todayMedCount = summary?.health.today_medicine_count ?? 0;
  const latestMedName = summary?.health.latest_medicine_name ?? null;
  const latestMedAt = summary?.health.latest_medicine_at ?? null;

  let healthValue = '—';
  let healthSub = '暂无健康记录';
  let healthAlertTone: 'warning' | 'destructive' | null = null;

  if (latestTemp !== null && isTempRecent) {
    healthValue = `${latestTemp.toFixed(1)} ℃`;
    const baseSub = `${tempSeverity?.label ?? ''} · ${formatTimeSince(latestTempAt, now)}`;
    healthSub = todayMedCount > 0 ? `${baseSub} · 今日用药 ${todayMedCount} 次` : baseSub;
    healthAlertTone = tempSeverity && tempSeverity.level !== 'normal' ? tempSeverity.level : null;
  } else if (todayMedCount > 0) {
    healthValue = `用药 ${todayMedCount} 次`;
    healthSub = latestMedName
      ? `${latestMedName} · ${formatTimeSince(latestMedAt, now)}`
      : `今日已记录用药 ${todayMedCount} 次`;
  } else if (latestTemp !== null) {
    healthValue = `${latestTemp.toFixed(1)} ℃`;
    healthSub = `${tempSeverity?.label ?? ''} · ${formatTimeSince(latestTempAt, now)}`;
  }

  const feedingMeta = RECORD_CATEGORY_META.feeding;
  const sleepMeta = RECORD_CATEGORY_META.sleep;
  const careMeta = RECORD_CATEGORY_META.care;
  const healthMeta = RECORD_CATEGORY_META.health;

  return [
    {
      id: feedingMeta.id,
      label: '今日喂养',
      value: feedingValue,
      sub: feedingSub,
      iconClass: feedingMeta.softClass,
      icon: feedingMeta.icon,
      to: feedingMeta.url,
      alertTone: null,
    },
    {
      id: sleepMeta.id,
      label: '今日睡眠',
      value: sleepValue,
      sub: sleepSub,
      iconClass: sleepMeta.softClass,
      icon: sleepMeta.icon,
      to: sleepMeta.url,
      alertTone: null,
    },
    {
      id: careMeta.id,
      label: '今日护理',
      value: careValue,
      sub: careSub,
      iconClass: careMeta.softClass,
      icon: careMeta.icon,
      to: careMeta.url,
      alertTone: null,
    },
    {
      id: healthMeta.id,
      label: '健康观察',
      value: healthValue,
      sub: healthSub,
      iconClass: healthMeta.softClass,
      icon: healthMeta.icon,
      to: healthMeta.url,
      alertTone: healthAlertTone,
    },
  ];
}

function buildFocusAlertBanner(
  overview: VaccineOverviewResponse,
  kind: 'scheduled_overdue' | 'overdue' | 'scheduled_soon' | 'due_soon',
): DashboardVaccineAlertBanner | null {
  const focus = overview.summary.next_focus;
  if (!focus) return null;
  const badgeMeta = getAlertBadgeMeta(kind);
  const focusDoses = overview.doses.filter((d) => focus.dose_ids.includes(d.id));
  const doseText = focusDoses.map((d) => formatDoseShortTitle(d)).join('、') || focus.age_label;
  const dateText = `${formatShortCnDate(focus.target_date, overview.today)}${focus.scheduled_time ? ` ${focus.scheduled_time}` : ''}`;
  const countdown = formatDaysUntilLabel(focus.days_until, kind.startsWith('scheduled') ? 'scheduled' : 'pending');
  const clinicPart = focus.clinic_name ? ` · ${focus.clinic_name}` : '';
  const tone =
    kind === 'scheduled_overdue' || kind === 'overdue' ? 'destructive' : kind === 'scheduled_soon' ? 'info' : 'warning';

  return {
    kind,
    badgeLabel: badgeMeta.label,
    badgeVariant: badgeMeta.variant === 'success' ? 'secondary' : badgeMeta.variant,
    tone,
    title: `${dateText} · ${doseText}`,
    detail: `${focus.age_label}${clinicPart}`,
    countdown,
  };
}

/** 判断疫苗总览当前是否存在优先于产院待确认的已预约紧急态（预约已过 / 7 天内即将接种）。 */
function hasUrgentScheduledVaccine(overview: VaccineOverviewResponse): boolean {
  const kind = overview.summary.next_focus?.kind;
  return kind === 'scheduled_overdue' || kind === 'scheduled_soon';
}

/**
 * 推导首页首屏常驻的疫苗提醒条（平稳期返回 null）：
 * 已预约紧急态（预约已过 / 7 天内即将接种）优先于产院待确认，避免早产暂缓产院苗时遮蔽紧急预约；
 * 其次提示产院出生疫苗待确认，再其次提示常规待补种或 14 天内可接种。
 */
export function selectDashboardVaccineAlert(
  overview: VaccineOverviewResponse | undefined,
): DashboardVaccineAlertBanner | null {
  if (!overview) return null;
  const { summary, doses } = overview;
  const focus = summary.next_focus;

  if (
    focus &&
    hasUrgentScheduledVaccine(overview) &&
    (focus.kind === 'scheduled_overdue' || focus.kind === 'scheduled_soon')
  ) {
    return buildFocusAlertBanner(overview, focus.kind);
  }

  if (summary.birth_confirm_pending) {
    const pendingBirth = doses.filter((d) => summary.birth_pending_dose_ids.includes(d.id));
    const names = pendingBirth.map((d) => formatDoseShortTitle(d)).join('、');
    return {
      kind: 'birth_confirm',
      badgeLabel: '待确认',
      badgeVariant: 'warning',
      tone: 'primary',
      title: '产院出生疫苗待确认',
      detail: names ? `请对照出院小结或接种证核对：${names}` : '请核对产院接种的乙肝第1剂与卡介苗记录',
    };
  }

  if (focus && (focus.kind === 'overdue' || focus.kind === 'due_soon')) {
    return buildFocusAlertBanner(overview, focus.kind);
  }

  return null;
}

/** 统一推导看板下方「疫苗接种计划」卡的展示模式、关联剂次及 NIP 进度，与顶部提醒条共享优先级规则。 */
export function selectDashboardVaccineCardFocus(
  overview: VaccineOverviewResponse | undefined,
): DashboardVaccineCardFocus {
  if (!overview) {
    return { showBirthConfirm: false, birthPendingDoses: [], focusDoses: [], nipPercent: 0 };
  }
  const { summary, doses } = overview;
  const showBirthConfirm = summary.birth_confirm_pending && !hasUrgentScheduledVaccine(overview);
  const birthPendingDoses = showBirthConfirm ? doses.filter((d) => summary.birth_pending_dose_ids.includes(d.id)) : [];
  const focus = summary.next_focus;
  const focusDoses = focus ? doses.filter((d) => focus.dose_ids.includes(d.id)) : [];
  const nipPercent = summary.nip_total > 0 ? Math.round((summary.nip_completed / summary.nip_total) * 100) : 0;
  return { showBirthConfirm, birthPendingDoses, focusDoses, nipPercent };
}

/**
 * 检测宝宝最近 48 小时（按本地自然日 0..2 天）内是否有刚接种完成的疫苗，
 * 用于在看板健康观察区触发轻量测温联动提示。
 */
export function findRecentCompletedVaccineForTempCue(
  overview: VaccineOverviewResponse | undefined,
): PostVaccineTempCue | null {
  if (!overview) return null;
  const todayDate = parseLocalDateKey(overview.today);
  if (!todayDate) return null;

  const recent = overview.doses
    .filter((d) => {
      if (d.status !== 'completed' || !d.vaccinated_at) return false;
      const vacDate = parseLocalDateKey(d.vaccinated_at);
      if (!vacDate) return false;
      const diffDays = differenceInCalendarDays(todayDate, vacDate);
      return diffDays >= 0 && diffDays <= 2;
    })
    .sort((a, b) => (b.vaccinated_at ?? '').localeCompare(a.vaccinated_at ?? '') || b.id - a.id);

  if (recent.length === 0 || !recent[0].vaccinated_at) return null;
  const latestDate = recent[0].vaccinated_at;
  const latestBatch = recent.filter((d) => d.vaccinated_at === latestDate);
  return {
    doseNames: latestBatch.map((d) => formatDoseShortTitle(d)),
  };
}

interface AdaptiveFeedingOneTap {
  readonly title: string;
  readonly hint: string;
  readonly toastTitle: string;
  readonly buildRequest: (recordedAt: string) => SaveRecordRequest;
}

type DashboardOneTapKind = 'feeding' | 'pee' | 'poop' | 'bath';

interface DashboardOneTapPreset extends OneTapRecordAction<DashboardOneTapKind> {
  readonly title: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly tileClass: string;
  readonly iconClass: string;
}

/**
 * 根据宝宝最近喂养习惯自适应首页第一张一键直记卡（配方奶 / 瓶喂母乳 / 亲喂左右交替），
 * 避免纯母乳或混合喂养家庭因卡片写死配方奶而误记。
 */
function buildAdaptiveFeedingOneTap(
  defaults: SmartDefaults | undefined,
  defaultsReady: boolean,
): AdaptiveFeedingOneTap {
  const feeding = defaults?.feeding;
  const lastMilkML = feeding?.last_milk_ml ?? FEEDING_DEFAULTS.milkML;

  if (!defaultsReady) {
    return {
      title: '再来一顿',
      hint: '加载喂养习惯…',
      toastTitle: `已记录 · ${lastMilkML} ml 配方奶`,
      buildRequest: (recordedAt) => ({
        category: 'feeding',
        payload: { subtype: 'formula', amount_ml: lastMilkML, recorded_at: recordedAt, note: '' },
      }),
    };
  }

  // 优先基于最近一次奶类喂养类型（last_milk_subtype，忽略辅食），避免纯亲喂/瓶喂母乳宝宝记完辅食后直记卡回退为配方奶。
  if (feeding?.last_milk_subtype === 'breast') {
    if (feeding.last_breast_mode === 'bottle') {
      return {
        title: '再来一顿',
        hint: `${lastMilkML} ml 瓶喂母乳`,
        toastTitle: `已记录 · ${lastMilkML} ml 瓶喂母乳`,
        buildRequest: (recordedAt) => ({
          category: 'feeding',
          payload: {
            subtype: 'breast',
            feeding_mode: 'bottle',
            amount_ml: lastMilkML,
            recorded_at: recordedAt,
            note: '',
          },
        }),
      };
    }

    const side = feeding.suggested_breast_side ?? 'left';
    const durationMin = feeding.last_breast_duration_min || FEEDING_DEFAULTS.breastMin;
    const sideLabel = BREAST_SIDE_LABELS[side];
    return {
      title: '再来一次亲喂',
      hint: `${sideLabel} · ${durationMin} 分钟`,
      toastTitle: `已记录 · 亲喂 ${sideLabel} ${durationMin} 分钟`,
      buildRequest: (recordedAt) => ({
        category: 'feeding',
        payload: {
          subtype: 'breast',
          feeding_mode: 'direct',
          breast_side: side,
          duration_min: durationMin,
          recorded_at: recordedAt,
          note: '',
        },
      }),
    };
  }

  return {
    title: '再来一顿',
    hint: `${lastMilkML} ml 配方奶`,
    toastTitle: `已记录 · ${lastMilkML} ml 配方奶`,
    buildRequest: (recordedAt) => ({
      category: 'feeding',
      payload: { subtype: 'formula', amount_ml: lastMilkML, recorded_at: recordedAt, note: '' },
    }),
  };
}

/**
 * 统一构造首页看板 4 张高频一键直记预设（自适应喂养 / 嘘嘘 / 便便正常 / 洗澡），
 * 集中收敛直记载荷与撤销文案，避免页面组件散落预设定义或跨层依赖快记 codec。
 */
export function buildDashboardOneTapPresets(
  defaults: SmartDefaults | undefined,
  defaultsReady: boolean,
): readonly DashboardOneTapPreset[] {
  const adaptiveFeedingOneTap = buildAdaptiveFeedingOneTap(defaults, defaultsReady);

  return [
    {
      key: 'feeding',
      title: adaptiveFeedingOneTap.title,
      hint: adaptiveFeedingOneTap.hint,
      icon: Milk,
      tileClass: 'border-feeding/35 bg-card hover:border-feeding/70 hover:bg-feeding-soft/25',
      iconClass: 'bg-feeding-soft text-feeding-soft-foreground',
      disabled: !defaultsReady,
      toastTitle: adaptiveFeedingOneTap.toastTitle,
      undoToastTitle: '已撤销刚才的喂养记录',
      buildRequest: adaptiveFeedingOneTap.buildRequest,
    },
    {
      key: 'pee',
      title: '嘘嘘',
      hint: '尿布记录',
      icon: Droplets,
      tileClass: 'border-care/35 bg-card hover:border-care/70 hover:bg-care-soft/25',
      iconClass: 'bg-care-soft text-care-soft-foreground',
      toastTitle: '已记录 · 嘘嘘',
      undoToastTitle: '已撤销刚才的护理记录',
      buildRequest: (recordedAt) => ({
        category: 'care',
        payload: { subtype: 'diaper', diaper_kind: 'pee', recorded_at: recordedAt, note: '' },
      }),
    },
    {
      key: 'poop',
      title: '便便正常',
      hint: '软便 · 黄色',
      icon: Baby,
      tileClass: 'border-care/35 bg-card hover:border-care/70 hover:bg-care-soft/25',
      iconClass: 'bg-care-soft text-care-soft-foreground',
      toastTitle: '已记录 · 便便正常',
      undoToastTitle: '已撤销刚才的护理记录',
      buildRequest: (recordedAt) => ({
        category: 'care',
        payload: {
          subtype: 'diaper',
          diaper_kind: 'poop',
          stool_consistency: 'soft',
          stool_color: 'yellow',
          recorded_at: recordedAt,
          note: '',
        },
      }),
    },
    {
      key: 'bath',
      title: '洗澡',
      hint: '日常护理',
      icon: Bath,
      tileClass: 'border-border/80 bg-card hover:border-primary/45 hover:bg-accent/35',
      iconClass: 'bg-secondary text-secondary-foreground',
      toastTitle: '已记录 · 洗澡',
      undoToastTitle: '已撤销刚才的洗澡记录',
      buildRequest: (recordedAt) => ({
        category: 'care',
        payload: { subtype: 'bath', recorded_at: recordedAt, note: '' },
      }),
    },
  ];
}

/** 首页今日汇总查询：每 60 秒轮询刷新，供首页看板实时展示照护概览。 */
export function useDashboardSummaryQuery() {
  return useBabyQuery({
    ...dashboardSummaryQueryOptions<DashboardSummary>(),
    refetchInterval: 60_000,
  });
}

export function useDashboardTrendsQuery(days = 7) {
  return useBabyQuery({
    queryKey: (babyId) => [...babyDashboardQueryKey(babyId), 'trends', days],
    queryFn: (babyId, signal) =>
      babyApiRequest<DashboardTrends>(babyId, '/dashboard/trends', { tz: true, query: { days }, signal }),
  });
}
