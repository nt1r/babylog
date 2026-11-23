import { createFileRoute } from '@tanstack/react-router';
import { MoonStar, PlusIcon } from 'lucide-react';
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
  flattenInfiniteList,
  type RecordRange,
  type SleepDailySummary,
  type SleepRecord,
  useDeleteRecordMutation,
  useSleepListQuery,
} from '@/lib/records';
import {
  formatDurationMin,
  formatLocalDateTimeShort,
  formatLocalTimeFromISO,
  getLocalDateKeyFromISO,
} from '@/lib/time';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/sleep')({
  component: SleepPage,
});

function formatSleepSummary(sum?: SleepDailySummary): string {
  if (!sum) return '';
  const parts = [`当日共睡 ${formatDurationMin(sum.total_min)}`];
  if (sum.nap_count > 0) parts.push(`小睡 ${sum.nap_count} 次`);
  if (sum.night_min > 0) parts.push(`夜觉 ${formatDurationMin(sum.night_min)}`);
  return parts.join(' · ');
}

function SleepPage() {
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState<RecordRange>('7d');
  const [deleting, setDeleting] = useState<SleepRecord | null>(null);

  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const listQuery = useSleepListQuery({ subtype: filter, range });
  const deleteMutation = useDeleteRecordMutation('sleep');

  const { items, total, dailySummaries } = flattenInfiniteList(listQuery.data);
  const groups = groupItemsByDateKey(items, (r) => getLocalDateKeyFromISO(r.started_at));

  async function handleConfirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('睡眠记录已删除');
      setDeleting(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

  const deletingSummary = deleting
    ? `将删除 ${formatLocalDateTimeShort(deleting.started_at)} 入睡的「${deleting.subtype === 'night' ? '夜间整觉' : '白天小睡'} · ${formatDurationMin(deleting.duration_min)}」，删除后不可恢复。`
    : '';

  return (
    <>
      <ListPageCard
        title="睡眠记录"
        badge={
          <span className="flex size-7 items-center justify-center rounded-lg bg-sleep-soft text-sleep-soft-foreground">
            <MoonStar className="size-4" strokeWidth={1.8} />
          </span>
        }
        headerAction={
          <Button
            size="sm"
            onClick={() => openQuickRecord('sleep', { initialSubtype: filter === 'all' ? undefined : filter })}
          >
            <PlusIcon className="size-4" />
            记一笔睡眠
          </Button>
        }
        filters={
          <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="nap">白天小睡</TabsTrigger>
              <TabsTrigger value="night">夜间整觉</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={<RangeFilterPills value={range} onChange={setRange} />}
      >
        {listQuery.isLoading ? (
          <RecordListSkeleton />
        ) : listQuery.isError ? (
          <RecordListError
            message={listQuery.error instanceof Error ? listQuery.error.message : '无法加载睡眠记录'}
            onRetry={() => void listQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <LittleMoments className="max-w-44" />
            </EmptyMedia>
            <EmptyTitle>当前范围内还没有睡眠记录</EmptyTitle>
            <EmptyDescription>记录入睡和醒来时间，帮你掌握宝宝的小睡间隔与夜觉节律。</EmptyDescription>
            <EmptyActions>
              <Button
                onClick={() => openQuickRecord('sleep', { initialSubtype: filter === 'all' ? undefined : filter })}
              >
                <MoonStar className="size-4" />
                记一笔睡眠
              </Button>
              {range !== 'all' ? (
                <Button variant="outline" onClick={() => setRange('all')}>
                  查看全部时间
                </Button>
              ) : null}
            </EmptyActions>
          </Empty>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <RecordDayGroup
                key={group.dateKey}
                dateKey={group.dateKey}
                summary={formatSleepSummary(dailySummaries[group.dateKey])}
              >
                {group.items.map((rec) => {
                  const startClock = formatLocalTimeFromISO(rec.started_at);
                  const endClock = formatLocalTimeFromISO(rec.ended_at);
                  const crossDay = getLocalDateKeyFromISO(rec.started_at) !== getLocalDateKeyFromISO(rec.ended_at);
                  return (
                    <RecordRowCard
                      key={rec.id}
                      timeLabel={startClock}
                      badge={<Badge variant="sleep">{rec.subtype === 'night' ? '夜间整觉' : '白天小睡'}</Badge>}
                      title={formatDurationMin(rec.duration_min)}
                      subtitle={crossDay ? `${startClock} → 次日 ${endClock}` : `${startClock} → ${endClock}`}
                      note={rec.note}
                      onEdit={() =>
                        openQuickRecord('sleep', { mode: 'edit', record: { category: 'sleep', record: rec } })
                      }
                      onDuplicate={() =>
                        openQuickRecord('sleep', { mode: 'duplicate', record: { category: 'sleep', record: rec } })
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
        title="确认删除这条睡眠记录？"
        description={deletingSummary}
        confirmLabel={deleteMutation.isPending ? '正在删除…' : '确认删除'}
        pending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
