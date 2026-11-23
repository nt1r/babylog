import { createFileRoute } from '@tanstack/react-router';
import { HeartPulse, PlusIcon } from 'lucide-react';
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
  getTemperatureSeverity,
  type HealthDailySummary,
  type HealthRecord,
  type RecordRange,
  useDeleteRecordMutation,
  useHealthListQuery,
} from '@/lib/records';
import { formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/health')({
  component: HealthPage,
});

function formatHealthSummary(sum?: HealthDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.latest_temp_c !== null) parts.push(`最近体温 ${sum.latest_temp_c.toFixed(1)} ℃`);
  if (sum.medicine_count > 0) parts.push(`用药 ${sum.medicine_count} 次`);
  if (sum.growth_count > 0) parts.push(`生长 ${sum.growth_count} 次`);
  if (sum.teeth_count > 0) parts.push(`长牙 ${sum.teeth_count} 次`);
  parts.push(`共 ${sum.total_count} 笔`);
  return parts.join(' · ');
}

function describeHealth(rec: HealthRecord): {
  badge: string;
  badgeVariant: 'health' | 'warning' | 'destructive';
  title: string;
  subtitle?: string;
} {
  if (rec.subtype === 'temperature' && rec.temperature_c !== null) {
    const severity = getTemperatureSeverity(rec.temperature_c);
    return {
      badge: severity.level === 'normal' ? '体温' : severity.label,
      badgeVariant: severity.level === 'normal' ? 'health' : severity.level,
      title: `${rec.temperature_c.toFixed(1)} ℃`,
    };
  }
  if (rec.subtype === 'medicine') {
    return {
      badge: '用药',
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
      badge: '身高体重',
      badgeVariant: 'health',
      title: metrics.join(' · ') || '生长记录',
    };
  }
  return {
    badge: '长牙',
    badgeVariant: 'health',
    title: rec.tooth_note ?? '出牙记录',
  };
}

function HealthPage() {
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState<RecordRange>('30d');
  const [deleting, setDeleting] = useState<HealthRecord | null>(null);

  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const listQuery = useHealthListQuery({ subtype: filter, range });
  const deleteMutation = useDeleteRecordMutation('health');

  const { items, total, dailySummaries } = flattenInfiniteList(listQuery.data);
  const groups = groupItemsByDateKey(items, (r) => getLocalDateKeyFromISO(r.recorded_at));

  async function handleConfirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('健康记录已删除');
      setDeleting(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
    }
  }

  return (
    <>
      <ListPageCard
        title="健康与生长"
        description="记录体温、用药、身高体重与长牙等成长档案。"
        badge={
          <span className="flex size-7 items-center justify-center rounded-lg bg-health-soft text-health-soft-foreground">
            <HeartPulse className="size-4" strokeWidth={1.8} />
          </span>
        }
        headerAction={
          <Button
            size="sm"
            onClick={() => openQuickRecord('health', { initialSubtype: filter === 'all' ? undefined : filter })}
          >
            <PlusIcon className="size-4" />
            记一笔健康
          </Button>
        }
        filters={
          <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="temperature">体温</TabsTrigger>
              <TabsTrigger value="medicine">用药</TabsTrigger>
              <TabsTrigger value="growth">身高体重</TabsTrigger>
              <TabsTrigger value="teeth">长牙</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={<RangeFilterPills value={range} onChange={setRange} />}
      >
        {listQuery.isLoading ? (
          <RecordListSkeleton />
        ) : listQuery.isError ? (
          <RecordListError
            message={listQuery.error instanceof Error ? listQuery.error.message : '无法加载健康记录'}
            onRetry={() => void listQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <LittleMoments className="max-w-44" />
            </EmptyMedia>
            <EmptyTitle>当前范围内还没有健康与生长记录</EmptyTitle>
            <EmptyDescription>把体温变化、用药时间和身高体重记在一起，随时查看宝宝的健康档案。</EmptyDescription>
            <EmptyActions>
              <Button
                onClick={() => openQuickRecord('health', { initialSubtype: filter === 'all' ? undefined : filter })}
              >
                <HeartPulse className="size-4" />
                记一笔健康
              </Button>
            </EmptyActions>
          </Empty>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <RecordDayGroup
                key={group.dateKey}
                dateKey={group.dateKey}
                summary={formatHealthSummary(dailySummaries[group.dateKey])}
              >
                {group.items.map((rec) => {
                  const info = describeHealth(rec);
                  return (
                    <RecordRowCard
                      key={rec.id}
                      timeLabel={formatLocalTimeFromISO(rec.recorded_at)}
                      badge={<Badge variant={info.badgeVariant}>{info.badge}</Badge>}
                      title={info.title}
                      subtitle={info.subtitle}
                      note={rec.note}
                      onEdit={() =>
                        openQuickRecord('health', { mode: 'edit', record: { category: 'health', record: rec } })
                      }
                      onDuplicate={() =>
                        openQuickRecord('health', { mode: 'duplicate', record: { category: 'health', record: rec } })
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
        title="确认删除这条健康记录？"
        description="删除后看板最近体温与列表小计会自动更新，此操作不可恢复。"
        confirmLabel={deleteMutation.isPending ? '正在删除…' : '确认删除'}
        pending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
