import { createFileRoute } from '@tanstack/react-router';
import { Baby, PlusIcon } from 'lucide-react';
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
  type CareDailySummary,
  type CareRecord,
  DIAPER_KIND_LABELS,
  flattenInfiniteList,
  type RecordRange,
  STOOL_COLOR_LABELS,
  STOOL_CONSISTENCY_LABELS,
  useCareListQuery,
  useDeleteRecordMutation,
} from '@/lib/records';
import { formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/care')({
  component: CarePage,
});

function formatCareSummary(sum?: CareDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.pee_count > 0) parts.push(`嘘嘘 ${sum.pee_count}`);
  if (sum.poop_count > 0) parts.push(`便便 ${sum.poop_count}`);
  if (sum.bath_count > 0) parts.push(`洗澡 ${sum.bath_count}`);
  if (sum.other_count > 0) parts.push(`其他 ${sum.other_count}`);
  parts.push(`共 ${sum.total_count} 次`);
  return parts.join(' · ');
}

function describeCare(rec: CareRecord): { badge: string; title: string; subtitle?: string } {
  if (rec.subtype === 'diaper') {
    const title = rec.diaper_kind ? DIAPER_KIND_LABELS[rec.diaper_kind] : '换尿布';
    const detail: string[] = [];
    if (rec.stool_consistency) detail.push(`性状：${STOOL_CONSISTENCY_LABELS[rec.stool_consistency]}`);
    if (rec.stool_color) detail.push(`颜色：${STOOL_COLOR_LABELS[rec.stool_color]}`);
    return {
      badge: '排便与尿布',
      title,
      subtitle: detail.length > 0 ? detail.join(' · ') : undefined,
    };
  }
  if (rec.subtype === 'bath') {
    return { badge: '洗澡', title: '完成洗澡' };
  }
  return { badge: '其他护理', title: rec.care_title ?? '日常护理' };
}

function CarePage() {
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState<RecordRange>('7d');
  const [deleting, setDeleting] = useState<CareRecord | null>(null);

  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const listQuery = useCareListQuery({ subtype: filter, range });
  const deleteMutation = useDeleteRecordMutation('care');

  const { items, total, dailySummaries } = flattenInfiniteList(listQuery.data);
  const groups = groupItemsByDateKey(items, (r) => getLocalDateKeyFromISO(r.recorded_at));

  async function handleConfirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('护理记录已删除');
      setDeleting(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

  return (
    <>
      <ListPageCard
        title="日常护理"
        description="记录大小便、换尿布、洗澡与日常照护小事。"
        badge={
          <span className="flex size-7 items-center justify-center rounded-lg bg-care-soft text-care-soft-foreground">
            <Baby className="size-4" strokeWidth={1.8} />
          </span>
        }
        headerAction={
          <Button
            size="sm"
            onClick={() => openQuickRecord('care', { initialSubtype: filter === 'all' ? undefined : filter })}
          >
            <PlusIcon className="size-4" />
            记一笔护理
          </Button>
        }
        filters={
          <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="diaper">排便与尿布</TabsTrigger>
              <TabsTrigger value="bath">洗澡</TabsTrigger>
              <TabsTrigger value="other">其他护理</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={<RangeFilterPills value={range} onChange={setRange} />}
      >
        {listQuery.isLoading ? (
          <RecordListSkeleton />
        ) : listQuery.isError ? (
          <RecordListError
            message={listQuery.error instanceof Error ? listQuery.error.message : '无法加载护理记录'}
            onRetry={() => void listQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <LittleMoments className="max-w-44" />
            </EmptyMedia>
            <EmptyTitle>当前范围内还没有护理记录</EmptyTitle>
            <EmptyDescription>随手记下换尿布、便便性状和洗澡时间，照护细节随时可查。</EmptyDescription>
            <EmptyActions>
              <Button
                onClick={() => openQuickRecord('care', { initialSubtype: filter === 'all' ? undefined : filter })}
              >
                <Baby className="size-4" />
                记一笔护理
              </Button>
            </EmptyActions>
          </Empty>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <RecordDayGroup
                key={group.dateKey}
                dateKey={group.dateKey}
                summary={formatCareSummary(dailySummaries[group.dateKey])}
              >
                {group.items.map((rec) => {
                  const info = describeCare(rec);
                  return (
                    <RecordRowCard
                      key={rec.id}
                      timeLabel={formatLocalTimeFromISO(rec.recorded_at)}
                      badge={<Badge variant="care">{info.badge}</Badge>}
                      title={info.title}
                      subtitle={info.subtitle}
                      note={rec.note}
                      onEdit={() =>
                        openQuickRecord('care', { mode: 'edit', record: { category: 'care', record: rec } })
                      }
                      onDuplicate={() =>
                        openQuickRecord('care', { mode: 'duplicate', record: { category: 'care', record: rec } })
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
        title="确认删除这条护理记录？"
        description="删除后当日护理次数统计会自动更新，此操作不可恢复。"
        confirmLabel={deleteMutation.isPending ? '正在删除…' : '确认删除'}
        pending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
