import { createFileRoute, Link } from '@tanstack/react-router';
import { BellRing, HomeIcon, Syringe } from 'lucide-react';
import { LittleMoments } from '@/components/brand/little-moments';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export const Route = createFileRoute('/_app/reminders')({
  component: RemindersPage,
});

function RemindersPage() {
  return (
    <ListPageCard
      title="提醒待办"
      badge={
        <span className="flex size-7 items-center justify-center rounded-lg bg-care-soft text-care-soft-foreground">
          <BellRing className="size-4" strokeWidth={1.8} />
        </span>
      }
    >
      <Empty>
        <EmptyMedia>
          <LittleMoments className="max-w-44" />
        </EmptyMedia>
        <EmptyTitle>更多提醒待办正在准备中</EmptyTitle>
        <EmptyDescription>
          宝宝疫苗接种计划、日历与预约提醒已上线；定时用药与儿保体检提醒正在陆续完善。
        </EmptyDescription>
        <EmptyActions>
          <Button render={<Link to="/vaccines" />} nativeButton={false}>
            <Syringe className="size-4" />
            前往疫苗接种
          </Button>
          <Button variant="outline" render={<Link to="/dashboard" />} nativeButton={false}>
            <HomeIcon className="size-4" />
            返回首页看板
          </Button>
        </EmptyActions>
      </Empty>
    </ListPageCard>
  );
}
