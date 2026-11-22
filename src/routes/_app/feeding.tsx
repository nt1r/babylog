import { createFileRoute } from '@tanstack/react-router';
import { Milk, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/feeding')({
  component: FeedingPage,
});

function FeedingPage() {
  const [filter, setFilter] = useState('all');
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);

  return (
    <ListPageCard
      title="喂养记录"
      description="记录母乳、配方奶与辅食时间、奶量和时长。"
      badge={
        <span className="flex size-7 items-center justify-center rounded-lg bg-feeding-soft text-feeding-soft-foreground">
          <Milk className="size-4" strokeWidth={1.8} />
        </span>
      }
      headerAction={
        <Button size="sm" onClick={() => openQuickRecord('feeding')}>
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
    >
      <Empty>
        <EmptyMedia>
          <LittleMoments className="max-w-44" />
        </EmptyMedia>
        <EmptyTitle>还没有喂养记录</EmptyTitle>
        <EmptyDescription>记下宝宝的第一顿奶或辅食，这里会自动为你汇总每日奶量与规律。</EmptyDescription>
        <EmptyActions>
          <Button onClick={() => openQuickRecord('feeding')}>
            <Milk className="size-4" />
            记一笔喂养
          </Button>
        </EmptyActions>
      </Empty>
    </ListPageCard>
  );
}
