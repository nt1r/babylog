import { createFileRoute } from '@tanstack/react-router';
import { RecordListPage, type RecordRowDescriptor } from '@/components/record-list-page';
import { RECORD_CATEGORY_META, SLEEP_SUBTYPE_LABELS, SLEEP_SUBTYPE_OPTIONS } from '@/lib/categories';
import type { SleepDailySummary, SleepRecord } from '@/lib/records';
import {
  formatDurationMin,
  formatLocalDateTimeShort,
  formatLocalTimeFromISO,
  getLocalDateKeyFromISO,
} from '@/lib/time';

export const Route = createFileRoute('/_app/sleep')({
  component: SleepPage,
});

const META = RECORD_CATEGORY_META.sleep;
const SUBTYPE_TABS = [{ value: 'all', label: '全部' }, ...SLEEP_SUBTYPE_OPTIONS] as const;

function formatSleepSummary(sum?: SleepDailySummary): string {
  if (!sum) return '';
  const parts = [`当日共睡 ${formatDurationMin(sum.total_min)}`];
  if (sum.nap_count > 0) parts.push(`小睡 ${sum.nap_count} 次`);
  if (sum.night_min > 0) parts.push(`夜觉 ${formatDurationMin(sum.night_min)}`);
  return parts.join(' · ');
}

function describeSleep(rec: SleepRecord): RecordRowDescriptor {
  const startClock = formatLocalTimeFromISO(rec.started_at);
  const endClock = formatLocalTimeFromISO(rec.ended_at);
  const crossDay = getLocalDateKeyFromISO(rec.started_at) !== getLocalDateKeyFromISO(rec.ended_at);
  return {
    timeLabel: startClock,
    badge: SLEEP_SUBTYPE_LABELS[rec.subtype],
    title: formatDurationMin(rec.duration_min),
    subtitle: crossDay ? `${startClock} → 次日 ${endClock}` : `${startClock} → ${endClock}`,
  };
}

function SleepPage() {
  return (
    <RecordListPage
      category="sleep"
      title={META.pageTitle}
      icon={META.icon}
      badgeClassName={META.softClass}
      createButtonLabel={META.createLabel}
      subtypeTabs={SUBTYPE_TABS}
      loadErrorFallback="无法加载睡眠记录"
      emptyTitle="当前范围内还没有睡眠记录"
      emptyDescription="记录入睡和醒来时间，帮你掌握宝宝的小睡间隔与夜觉节律。"
      deleteDialogTitle="确认删除这条睡眠记录？"
      deleteSuccessToast="睡眠记录已删除"
      getDateKey={(rec) => getLocalDateKeyFromISO(rec.started_at)}
      formatDailySummary={formatSleepSummary}
      describeRow={describeSleep}
      formatDeleteDescription={(rec) =>
        `将删除 ${formatLocalDateTimeShort(rec.started_at)} 入睡的「${SLEEP_SUBTYPE_LABELS[rec.subtype]} · ${formatDurationMin(rec.duration_min)}」，删除后不可恢复。`
      }
    />
  );
}
