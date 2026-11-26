import { createFileRoute } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';
import { RecordListPage, type RecordRowDescriptor } from '@/components/record-list-page';
import { Button } from '@/components/ui/button';
import { FEEDING_SUBTYPE_LABELS, RECORD_CATEGORY_META } from '@/lib/categories';
import { ACCEPTANCE_LABELS, BREAST_SIDE_LABELS, type FeedingDailySummary, type FeedingRecord } from '@/lib/records';
import { formatLocalDateTimeShort, formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';
import { useBatchRecordStore } from '@/stores/batch-record';

export const Route = createFileRoute('/_app/feeding')({
  component: FeedingPage,
});

const META = RECORD_CATEGORY_META.feeding;

const SUBTYPE_TABS = [
  { value: 'all', label: '全部' },
  { value: 'breast', label: FEEDING_SUBTYPE_LABELS.breast },
  { value: 'formula', label: FEEDING_SUBTYPE_LABELS.formula },
  { value: 'solid', label: FEEDING_SUBTYPE_LABELS.solid },
] as const;

function formatFeedingSummary(sum?: FeedingDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.total_ml > 0) parts.push(`共 ${sum.total_ml} ml`);
  if (sum.direct_breast_count > 0) parts.push(`亲喂 ${sum.direct_breast_count} 次（${sum.direct_breast_min} 分钟）`);
  if (sum.solid_count > 0) parts.push(`${FEEDING_SUBTYPE_LABELS.solid} ${sum.solid_count} 次`);
  parts.push(`共 ${sum.total_count} 次`);
  return parts.join(' · ');
}

function describeFeeding(rec: FeedingRecord): RecordRowDescriptor {
  const timeLabel = formatLocalTimeFromISO(rec.recorded_at);
  if (rec.subtype === 'formula') {
    return { timeLabel, badge: FEEDING_SUBTYPE_LABELS.formula, title: `${rec.amount_ml ?? 0} ml` };
  }
  if (rec.subtype === 'breast') {
    if (rec.feeding_mode === 'bottle') {
      return { timeLabel, badge: '瓶喂母乳', title: `${rec.amount_ml ?? 0} ml` };
    }
    const side = rec.breast_side ? BREAST_SIDE_LABELS[rec.breast_side] : '';
    return { timeLabel, badge: '亲喂', title: `${side} · ${rec.duration_min ?? 0} 分钟` };
  }
  const subParts: string[] = [];
  if (rec.solid_amount) subParts.push(`份量：${rec.solid_amount}`);
  if (rec.acceptance) subParts.push(`接受度：${ACCEPTANCE_LABELS[rec.acceptance]}`);
  return {
    timeLabel,
    badge: FEEDING_SUBTYPE_LABELS.solid,
    title: rec.solid_food ?? FEEDING_SUBTYPE_LABELS.solid,
    subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
  };
}

function FeedingPage() {
  return (
    <RecordListPage
      category="feeding"
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
      loadErrorFallback="无法加载喂养记录"
      emptyTitle="当前范围内还没有喂养记录"
      emptyDescription="记下宝宝的一顿奶或辅食，这里会按天自动汇总。"
      deleteDialogTitle="确认删除这条喂养记录？"
      deleteSuccessToast="喂养记录已删除"
      getDateKey={(rec) => getLocalDateKeyFromISO(rec.recorded_at)}
      formatDailySummary={formatFeedingSummary}
      describeRow={describeFeeding}
      formatDeleteDescription={(rec) => {
        const info = describeFeeding(rec);
        return `将删除 ${formatLocalDateTimeShort(rec.recorded_at)} 的「${info.badge} · ${info.title}」，删除后不可恢复。`;
      }}
    />
  );
}
