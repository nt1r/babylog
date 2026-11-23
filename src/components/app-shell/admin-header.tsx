import { Link, useRouterState } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { ThemeSwitcher } from '@/components/app-shell/theme-switcher';
import { UserMenu } from '@/components/app-shell/user-menu';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { findNavItemByPath } from '@/navigation/menu';
import { usePreferencesStore } from '@/stores/preferences';

export function AdminHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const openQuickRecord = usePreferencesStore((state) => state.openQuickRecord);
  const currentItem = findNavItemByPath(pathname);
  // 记录列表页自身卡片头部已提供带子类型上下文的主按钮，避免桌面端上下双主色按钮重复。
  const showGlobalQuickRecord = !currentItem?.category;

  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-border/75 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md md:rounded-t-2xl md:pt-0">
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:inline-flex">
                <BreadcrumbLink render={<Link to="/dashboard" />}>BabyLog</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage className="truncate">{currentItem?.title ?? '首页看板'}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {showGlobalQuickRecord ? (
            <Button size="sm" className="hidden sm:inline-flex" onClick={() => openQuickRecord('feeding')}>
              <PlusIcon className="size-4" />
              记一笔
            </Button>
          ) : null}
          <ThemeSwitcher />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
