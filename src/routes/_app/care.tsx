import { createFileRoute } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';
import { RecordListPage, type RecordRowDescriptor } from '@/components/record-list-page';
import { Button } from '@/components/ui/button';
import { CARE_SUBTYPE_LABELS, CARE_SUBTYPE_OPTIONS, RECORD_CATEGORY_META } from '@/lib/categories';
import {
  type CareDailySummary,
  type CareRecord,
  DIAPER_KIND_LABELS,
  STOOL_COLOR_LABELS,
  STOOL_CONSISTENCY_LABELS,
} from '@/lib/records';
import { formatLocalDateTimeShort, formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';
import { useBatchRecordStore } from '@/stores/batch-record';

export const Route = createFileRoute('/_app/care')({
  component: CarePage,
});

const META = RECORD_CATEGORY_META.care;
const SUBTYPE_TABS = [{ value: 'all', label: '全部' }, ...CARE_SUBTYPE_OPTIONS] as const;

function formatCareSummary(sum?: CareDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.pee_count > 0) parts.push(`嘘嘘 ${sum.pee_count}`);
  if (sum.poop_count > 0) parts.push(`便便 ${sum.poop_count}`);
  if (sum.bath_count > 0) parts.push(`${CARE_SUBTYPE_LABELS.bath} ${sum.bath_count}`);
  if (sum.other_count > 0) parts.push(`其他 ${sum.other_count}`);
  parts.push(`共 ${sum.total_count} 次`);
  return parts.join(' · ');
}

function describeCare(rec: CareRecord): RecordRowDescriptor {
  const timeLabel = formatLocalTimeFromISO(rec.recorded_at);
  if (rec.subtype === 'diaper') {
    const title = rec.diaper_kind ? DIAPER_KIND_LABELS[rec.diaper_kind] : '换尿布';
    const detail: string[] = [];
    if (rec.stool_consistency) detail.push(`性状：${STOOL_CONSISTENCY_LABELS[rec.stool_consistency]}`);
    if (rec.stool_color) detail.push(`颜色：${STOOL_COLOR_LABELS[rec.stool_color]}`);
    return {
      timeLabel,
      badge: CARE_SUBTYPE_LABELS.diaper,
      title,
      subtitle: detail.length > 0 ? detail.join(' · ') : undefined,
    };
  }
  if (rec.subtype === 'bath') {
    return { timeLabel, badge: CARE_SUBTYPE_LABELS.bath, title: CARE_SUBTYPE_LABELS.bath };
  }
  return { timeLabel, badge: CARE_SUBTYPE_LABELS.other, title: rec.care_title ?? '日常护理' };
}

function CarePage() {
  return (
    <RecordListPage
      category="care"
      title={META.pageTitle}
      icon={META.icon}
      badgeClassName={META.softClass}
      createButtonLabel={META.createLabel}
      secondaryHeaderAction={
        <Button type="button" variant="outline" size="sm" onClick={() => useBatchRecordStore.getState().openBatch()}>
          <ClipboardList className="size-4" />
          批量补录
        </Button>
      }
      subtypeTabs={SUBTYPE_TABS}
      loadErrorFallback="无法加载护理记录"
      emptyTitle="当前范围内还没有护理记录"
      emptyDescription="随手记下换尿布、便便性状和洗澡时间，照护细节随时可查。"
      deleteDialogTitle="确认删除这条护理记录？"
      deleteSuccessToast="护理记录已删除"
      getDateKey={(rec) => getLocalDateKeyFromISO(rec.recorded_at)}
      formatDailySummary={formatCareSummary}
      describeRow={describeCare}
      formatDeleteDescription={(rec) => {
        const info = describeCare(rec);
        return `将删除 ${formatLocalDateTimeShort(rec.recorded_at)} 的「${info.badge} · ${info.title}」，删除后不可恢复。`;
      }}
    />
  );
}
