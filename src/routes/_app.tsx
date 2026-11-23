import { createFileRoute, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { AlertCircle, RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useBabyProfileQuery } from '@/lib/baby';
import { findNavItemByPath } from '@/navigation/menu';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/_app')({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navItem = findNavItemByPath(pathname);

  const babyQuery = useBabyProfileQuery(Boolean(user) && !restoring);

  useEffect(() => {
    if (user) {
      document.title = `${navItem?.title ?? '首页看板'} · BabyLog`;
    }
  }, [user, navItem]);

  if (restoring || (user && babyQuery.isLoading)) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="w-full max-w-4xl space-y-4">
          <Skeleton className="h-10 w-48 rounded-xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" search={{ redirect: pathname }} replace />;
  }

  if (babyQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Empty className="w-full max-w-md border-solid bg-card shadow-card">
          <EmptyMedia>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive-soft text-destructive-soft-foreground">
              <AlertCircle className="size-6" />
            </span>
          </EmptyMedia>
          <EmptyTitle>宝宝档案加载失败</EmptyTitle>
          <EmptyDescription>
            {babyQuery.error instanceof Error ? babyQuery.error.message : '暂时无法读取宝宝档案，请重试。'}
          </EmptyDescription>
          <EmptyActions>
            <Button onClick={() => void babyQuery.refetch()}>
              <RotateCw className="size-4" />
              重新加载
            </Button>
          </EmptyActions>
        </Empty>
      </div>
    );
  }

  if (babyQuery.data === null) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
