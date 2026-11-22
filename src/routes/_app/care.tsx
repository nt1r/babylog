import { createFileRoute } from '@tanstack/react-router';
import { Baby, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/care')({
  component: CarePage,
});

function CarePage() {
  const [filter, setFilter] = useState('all');
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);

  return (
    <ListPageCard
      title="日常护理"
      description="记录大小便、换尿布、洗澡与日常照护小事。"
      badge={
        <span className="flex size-7 items-center justify-center rounded-lg bg-care-soft text-care-soft-foreground">
          <Baby className="size-4" strokeWidth={1.8} />
        </span>
      }
      headerAction={
        <Button size="sm" onClick={() => openQuickRecord('care')}>
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
    >
      <Empty>
        <EmptyMedia>
          <LittleMoments className="max-w-44" />
        </EmptyMedia>
        <EmptyTitle>还没有护理记录</EmptyTitle>
        <EmptyDescription>随手记下换尿布、便便性状和洗澡时间，照护细节随时可查。</EmptyDescription>
        <EmptyActions>
          <Button onClick={() => openQuickRecord('care')}>
            <Baby className="size-4" />
            记一笔护理
          </Button>
        </EmptyActions>
      </Empty>
    </ListPageCard>
  );
}
