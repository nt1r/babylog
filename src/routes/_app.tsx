import { createFileRoute, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { AlertCircle, RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useSyncActiveBaby } from '@/lib/baby';
import { findNavItemByPath, isAccountLevelRoute } from '@/navigation/menu';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/_app')({
  component: AuthenticatedLayout,
});

/**
 * 已认证业务区布局守卫，按严格顺序执行五层门禁：
 * 1. 会话恢复或宝宝列表首次加载中 → 渲染骨架屏，避免闪烁跳转；
 * 2. 未登录 → 重定向至登录页并携带来源路径；
 * 3. 待修改初始密码 → 强制重定向至全屏改密页；
 * 4. 宝宝列表请求失败（仅拦截育儿业务页）→ 停留错误重试页，避免把网络故障误判为未建档；
 * 5. 当前账号尚无宝宝档案且访问育儿业务页 → 强制进入首次建档流程（账号级页面 `/settings` 与 `/admin/users` 放行）。
 */
function AuthenticatedLayout() {
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navItem = findNavItemByPath(pathname);
  const accountRoute = isAccountLevelRoute(pathname);

  const shouldLoadBabies = Boolean(user) && !restoring && !user?.must_change_password;
  const { babies, babiesQuery, isSynced } = useSyncActiveBaby(shouldLoadBabies);

  useEffect(() => {
    if (user) {
      document.title = `${navItem?.title ?? '首页看板'} · BabyLog`;
    }
  }, [user, navItem]);

  if (restoring || (shouldLoadBabies && (babiesQuery.isLoading || !isSynced))) {
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

  if (user.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }

  if (babiesQuery.isError && !accountRoute) {
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
            {babiesQuery.error instanceof Error ? babiesQuery.error.message : '暂时无法读取宝宝档案，请重试。'}
          </EmptyDescription>
          <EmptyActions>
            <Button onClick={() => void babiesQuery.refetch()}>
              <RotateCw className="size-4" />
              重新加载
            </Button>
          </EmptyActions>
        </Empty>
      </div>
    );
  }

  if (babies.length === 0 && !accountRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
