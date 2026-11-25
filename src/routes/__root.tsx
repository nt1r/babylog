import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, type ErrorComponentProps, Link, Outlet } from '@tanstack/react-router';
import { AlertCircle, HomeIcon } from 'lucide-react';
import { useEffect } from 'react';
import { LittleMoments } from '@/components/brand/little-moments';
import { Button } from '@/components/ui/button';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Toaster, toast } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setUnauthorizedHandler } from '@/lib/http';
import { registerServiceWorker } from '@/lib/pwa';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
  errorComponent: RootErrorPage,
});

function RootComponent() {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const syncSystemTheme = usePreferencesStore((state) => state.syncSystemTheme);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // 全局 401 未认证拦截：统一清空 Zustand 登录态与 TanStack Query 缓存，避免切号或失效后残留脏数据。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      useAuthStore.getState().setUser(null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    registerServiceWorker((applyUpdate) => {
      toast.info('BabyLog 有新版本可用', '点击更新即可加载最新界面与修复。', {
        timeout: 10_000,
        action: {
          label: '立即更新',
          onClick: applyUpdate,
        },
      });
    });
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => syncSystemTheme();
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [syncSystemTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Outlet />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Empty className="w-full max-w-md border-solid bg-card shadow-card">
        <EmptyMedia>
          <LittleMoments className="max-w-56" />
        </EmptyMedia>
        <EmptyTitle>找不到这个页面</EmptyTitle>
        <EmptyDescription>页面可能已经移动或暂未开放，回到首页看板继续记录宝宝的日常吧。</EmptyDescription>
        <EmptyActions>
          <Button render={<Link to="/dashboard" />} nativeButton={false}>
            <HomeIcon className="size-4" />
            返回首页看板
          </Button>
        </EmptyActions>
      </Empty>
    </div>
  );
}

function RootErrorPage({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : '请刷新页面或返回首页重试。';
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Empty className="w-full max-w-md border-solid bg-card shadow-card">
        <EmptyMedia>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive-soft text-destructive-soft-foreground">
            <AlertCircle className="size-6" />
          </span>
        </EmptyMedia>
        <EmptyTitle>页面加载出现一点问题</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
        <EmptyActions>
          <Button variant="outline" onClick={reset}>
            重试
          </Button>
          <Button render={<Link to="/dashboard" />} nativeButton={false}>
            返回首页
          </Button>
        </EmptyActions>
      </Empty>
    </div>
  );
}
