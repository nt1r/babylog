import { createFileRoute } from '@tanstack/react-router';
import { Milk, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { ListPageCard } from '@/components/list-page-card';
import {
  groupItemsByDateKey,
  RangeFilterPills,
  RecordDayGroup,
  RecordListError,
  RecordListSkeleton,
  RecordRowCard,
} from '@/components/record-list-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import {
  ACCEPTANCE_LABELS,
  BREAST_SIDE_LABELS,
  type FeedingDailySummary,
  type FeedingRecord,
  flattenInfiniteList,
  type RecordRange,
  useDeleteRecordMutation,
  useFeedingListQuery,
} from '@/lib/records';
import { formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/feeding')({
  component: FeedingPage,
});

function formatFeedingSummary(sum?: FeedingDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.total_ml > 0) parts.push(`共 ${sum.total_ml} ml`);
  if (sum.direct_breast_count > 0) parts.push(`亲喂 ${sum.direct_breast_count} 次 (${sum.direct_breast_min} 分)`);
  if (sum.solid_count > 0) parts.push(`辅食 ${sum.solid_count} 次`);
  parts.push(`${sum.total_count} 笔`);
  return parts.join(' · ');
}

function describeFeeding(rec: FeedingRecord): { badge: string; title: string; subtitle?: string } {
  if (rec.subtype === 'formula') {
    return { badge: '配方奶', title: `${rec.amount_ml ?? 0} ml` };
  }
  if (rec.subtype === 'breast') {
    if (rec.feeding_mode === 'bottle') {
      return { badge: '瓶喂母乳', title: `${rec.amount_ml ?? 0} ml` };
    }
    const side = rec.breast_side ? BREAST_SIDE_LABELS[rec.breast_side] : '';
    return { badge: '亲喂', title: `${side} · ${rec.duration_min ?? 0} 分钟` };
  }
  const subParts: string[] = [];
  if (rec.solid_amount) subParts.push(`份量：${rec.solid_amount}`);
  if (rec.acceptance) subParts.push(`接受度：${ACCEPTANCE_LABELS[rec.acceptance]}`);
  return {
    badge: '辅食',
    title: rec.solid_food ?? '辅食',
    subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
  };
}

function FeedingPage() {
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState<RecordRange>('7d');
  const [deleting, setDeleting] = useState<FeedingRecord | null>(null);

  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const listQuery = useFeedingListQuery({ subtype: filter, range });
  const deleteMutation = useDeleteRecordMutation('feeding');

  const { items, total, dailySummaries } = flattenInfiniteList(listQuery.data);
  const groups = groupItemsByDateKey(items, (r) => getLocalDateKeyFromISO(r.recorded_at));

  async function handleConfirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('喂养记录已删除');
      setDeleting(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

  return (
    <>
      <ListPageCard
        title="喂养记录"
        description="记录母乳、配方奶与辅食时间、奶量和时长。"
        badge={
          <span className="flex size-7 items-center justify-center rounded-lg bg-feeding-soft text-feeding-soft-foreground">
            <Milk className="size-4" strokeWidth={1.8} />
          </span>
        }
        headerAction={
          <Button
            size="sm"
            onClick={() => openQuickRecord('feeding', { initialSubtype: filter === 'all' ? undefined : filter })}
          >
            <PlusIcon className="size-4" />
            记一笔喂养
          </Button>
        }
        filters={
          <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="breast">母乳</TabsTrigger>
              <TabsTrigger value="formula">配方奶</TabsTrigger>
              <TabsTrigger value="solid">辅食</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={<RangeFilterPills value={range} onChange={setRange} />}
      >
        {listQuery.isLoading ? (
          <RecordListSkeleton />
        ) : listQuery.isError ? (
          <RecordListError
            message={listQuery.error instanceof Error ? listQuery.error.message : '无法加载喂养记录'}
            onRetry={() => void listQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <LittleMoments className="max-w-44" />
            </EmptyMedia>
            <EmptyTitle>当前范围内还没有喂养记录</EmptyTitle>
            <EmptyDescription>记下宝宝的一顿奶或辅食，这里会自动按自然日汇总每日奶量与亲喂时长。</EmptyDescription>
            <EmptyActions>
              <Button
                onClick={() => openQuickRecord('feeding', { initialSubtype: filter === 'all' ? undefined : filter })}
              >
                <Milk className="size-4" />
                记一笔喂养
              </Button>
            </EmptyActions>
          </Empty>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <RecordDayGroup
                key={group.dateKey}
                dateKey={group.dateKey}
                summary={formatFeedingSummary(dailySummaries[group.dateKey])}
              >
                {group.items.map((rec) => {
                  const info = describeFeeding(rec);
                  return (
                    <RecordRowCard
                      key={rec.id}
                      timeLabel={formatLocalTimeFromISO(rec.recorded_at)}
                      badge={<Badge variant="feeding">{info.badge}</Badge>}
                      title={info.title}
                      subtitle={info.subtitle}
                      note={rec.note}
                      onEdit={() =>
                        openQuickRecord('feeding', { mode: 'edit', record: { category: 'feeding', record: rec } })
                      }
                      onDuplicate={() =>
                        openQuickRecord('feeding', { mode: 'duplicate', record: { category: 'feeding', record: rec } })
                      }
                      onDelete={() => setDeleting(rec)}
                    />
                  );
                })}
              </RecordDayGroup>
            ))}

            {listQuery.hasNextPage ? (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {listQuery.isFetchingNextPage ? '加载中…' : `加载更多（已显示 ${items.length} / ${total}）`}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </ListPageCard>

      <DeleteConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="确认删除这条喂养记录？"
        description="删除后当日奶量与趋势统计会自动更新，此操作不可恢复。"
        confirmLabel={deleteMutation.isPending ? '正在删除…' : '确认删除'}
        pending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
