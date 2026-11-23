import { createFileRoute } from '@tanstack/react-router';
import { RecordListPage, type RecordRowDescriptor } from '@/components/record-list-page';
import { HEALTH_SUBTYPE_LABELS, HEALTH_SUBTYPE_OPTIONS, RECORD_CATEGORY_META } from '@/lib/categories';
import { getTemperatureSeverity, type HealthDailySummary, type HealthRecord } from '@/lib/records';
import { formatLocalDateTimeShort, formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';

export const Route = createFileRoute('/_app/health')({
  component: HealthPage,
});

const META = RECORD_CATEGORY_META.health;
const SUBTYPE_TABS = [{ value: 'all', label: '全部' }, ...HEALTH_SUBTYPE_OPTIONS] as const;

function formatHealthSummary(sum?: HealthDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.latest_temp_c !== null) parts.push(`最近体温 ${sum.latest_temp_c.toFixed(1)} ℃`);
  if (sum.medicine_count > 0) parts.push(`${HEALTH_SUBTYPE_LABELS.medicine} ${sum.medicine_count} 次`);
  if (sum.growth_count > 0) parts.push(`${HEALTH_SUBTYPE_LABELS.growth} ${sum.growth_count} 次`);
  if (sum.teeth_count > 0) parts.push(`${HEALTH_SUBTYPE_LABELS.teeth} ${sum.teeth_count} 次`);
  parts.push(`共 ${sum.total_count} 次`);
  return parts.join(' · ');
}

function describeHealth(rec: HealthRecord): RecordRowDescriptor {
  const timeLabel = formatLocalTimeFromISO(rec.recorded_at);
  if (rec.subtype === 'temperature' && rec.temperature_c !== null) {
    const severity = getTemperatureSeverity(rec.temperature_c);
    return {
      timeLabel,
      badge: severity.level === 'normal' ? HEALTH_SUBTYPE_LABELS.temperature : severity.label,
      badgeVariant: severity.level === 'normal' ? 'health' : severity.level,
      title: `${rec.temperature_c.toFixed(1)} ℃`,
    };
  }
  if (rec.subtype === 'medicine') {
    return {
      timeLabel,
      badge: HEALTH_SUBTYPE_LABELS.medicine,
      badgeVariant: 'health',
      title: rec.medicine_name ?? '用药记录',
      subtitle: rec.medicine_dosage ? `剂量：${rec.medicine_dosage}` : undefined,
    };
  }
  if (rec.subtype === 'growth') {
    const metrics: string[] = [];
    if (rec.weight_kg !== null) metrics.push(`体重 ${rec.weight_kg} kg`);
    if (rec.height_cm !== null) metrics.push(`身高 ${rec.height_cm} cm`);
    if (rec.head_cm !== null) metrics.push(`头围 ${rec.head_cm} cm`);
    return {
      timeLabel,
      badge: HEALTH_SUBTYPE_LABELS.growth,
      badgeVariant: 'health',
      title: metrics.join(' · ') || '生长记录',
    };
  }
  return {
    timeLabel,
    badge: HEALTH_SUBTYPE_LABELS.teeth,
    badgeVariant: 'health',
    title: rec.tooth_note ?? '出牙记录',
  };
}

function HealthPage() {
  return (
    <RecordListPage
      category="health"
      title={META.pageTitle}
      icon={META.icon}
      badgeClassName={META.softClass}
      createButtonLabel={META.createLabel}
      defaultRange="30d"
      subtypeTabs={SUBTYPE_TABS}
      loadErrorFallback="无法加载健康记录"
      emptyTitle="当前范围内还没有健康与生长记录"
      emptyDescription="把体温变化、用药时间和身高体重记在一起，随时查看。"
      deleteDialogTitle="确认删除这条健康记录？"
      deleteSuccessToast="健康记录已删除"
      getDateKey={(rec) => getLocalDateKeyFromISO(rec.recorded_at)}
      formatDailySummary={formatHealthSummary}
      describeRow={describeHealth}
      formatDeleteDescription={(rec) => {
        const info = describeHealth(rec);
        return `将删除 ${formatLocalDateTimeShort(rec.recorded_at)} 的「${info.badge} · ${info.title}」，删除后不可恢复。`;
      }}
    />
  );
}
