import { createFileRoute, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { Skeleton } from '@/components/ui/skeleton';
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

  useEffect(() => {
    if (user) {
      document.title = `${navItem?.title ?? '首页看板'} · BabyLog`;
    }
  }, [user, navItem]);

  if (restoring) {
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

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
