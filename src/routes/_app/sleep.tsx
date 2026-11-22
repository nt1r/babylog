import { createFileRoute } from '@tanstack/react-router';
import { MoonStar, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/sleep')({
  component: SleepPage,
});

function SleepPage() {
  const [filter, setFilter] = useState('all');
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);

  return (
    <ListPageCard
      title="睡眠记录"
      description="记录白天小睡与夜间整觉时长，摸清宝宝的作息规律。"
      badge={
        <span className="flex size-7 items-center justify-center rounded-lg bg-sleep-soft text-sleep-soft-foreground">
          <MoonStar className="size-4" strokeWidth={1.8} />
        </span>
      }
      headerAction={
        <Button size="sm" onClick={() => openQuickRecord('sleep')}>
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
    >
      <Empty>
        <EmptyMedia>
          <LittleMoments className="max-w-44" />
        </EmptyMedia>
        <EmptyTitle>还没有睡眠记录</EmptyTitle>
        <EmptyDescription>记录每次入睡和醒来的时间，帮你轻松掌握宝宝的小睡间隔与夜觉节律。</EmptyDescription>
        <EmptyActions>
          <Button onClick={() => openQuickRecord('sleep')}>
            <MoonStar className="size-4" />
            记一笔睡眠
          </Button>
        </EmptyActions>
      </Empty>
    </ListPageCard>
  );
}
