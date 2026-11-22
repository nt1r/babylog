import { createFileRoute } from '@tanstack/react-router';
import { HeartPulse, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/health')({
  component: HealthPage,
});

function HealthPage() {
  const [filter, setFilter] = useState('all');
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);

  return (
    <ListPageCard
      title="健康与生长"
      description="记录体温、用药、身高体重与长牙等成长档案。"
      badge={
        <span className="flex size-7 items-center justify-center rounded-lg bg-health-soft text-health-soft-foreground">
          <HeartPulse className="size-4" strokeWidth={1.8} />
        </span>
      }
      headerAction={
        <Button size="sm" onClick={() => openQuickRecord('health')}>
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
    >
      <Empty>
        <EmptyMedia>
          <LittleMoments className="max-w-44" />
        </EmptyMedia>
        <EmptyTitle>还没有健康与生长记录</EmptyTitle>
        <EmptyDescription>把体温变化、用药时间和身高体重记在一起，随时查看宝宝的健康成长曲线。</EmptyDescription>
        <EmptyActions>
          <Button onClick={() => openQuickRecord('health')}>
            <HeartPulse className="size-4" />
            记一笔健康
          </Button>
        </EmptyActions>
      </Empty>
    </ListPageCard>
  );
}
