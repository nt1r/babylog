import { createFileRoute } from '@tanstack/react-router';
import { BellRing, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/reminders')({
  component: RemindersPage,
});

function RemindersPage() {
  const [filter, setFilter] = useState('upcoming');
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);

  return (
    <ListPageCard
      title="提醒待办"
      description="集中管理疫苗接种、定时用药与儿保体检日程。"
      badge={
        <span className="flex size-7 items-center justify-center rounded-lg bg-care-soft text-care-soft-foreground">
          <BellRing className="size-4" strokeWidth={1.8} />
        </span>
      }
      headerAction={
        <Button size="sm" onClick={() => openQuickRecord('reminder')}>
          <PlusIcon className="size-4" />
          新建提醒
        </Button>
      }
      filters={
        <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
          <TabsList>
            <TabsTrigger value="upcoming">即将到期</TabsTrigger>
            <TabsTrigger value="vaccine">疫苗</TabsTrigger>
            <TabsTrigger value="done">已完成</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      <Empty>
        <EmptyMedia>
          <LittleMoments className="max-w-44" />
        </EmptyMedia>
        <EmptyTitle>近期暂无待办提醒</EmptyTitle>
        <EmptyDescription>把疫苗接种、定时用药和儿保体检记在这里，不再怕忙碌中遗忘。</EmptyDescription>
        <EmptyActions>
          <Button onClick={() => openQuickRecord('reminder')}>
            <BellRing className="size-4" />
            新建提醒
          </Button>
        </EmptyActions>
      </Empty>
    </ListPageCard>
  );
}
