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

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/75 bg-background/85 px-4 backdrop-blur-md md:rounded-t-2xl md:px-6">
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
        <Button
          size="sm"
          className="hidden sm:inline-flex"
          onClick={() => openQuickRecord(currentItem?.category ?? 'feeding')}
        >
          <PlusIcon className="size-4" />
          记一笔
        </Button>
        <ThemeSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
