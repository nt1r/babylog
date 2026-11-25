import { Link, useRouterState } from '@tanstack/react-router';
import { PlusIcon, Search } from 'lucide-react';
import { getShortcutModifierSymbol } from '@/components/app-shell/command-palette';
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
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { findNavItemByPath, openContextualCreate } from '@/navigation/menu';
import { useCommandPaletteStore } from '@/stores/command-palette';

export function AdminHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const openCommandPalette = useCommandPaletteStore((state) => state.setOpen);
  const currentItem = findNavItemByPath(pathname);
  // 记录列表页（含生长发育页）自身卡片头部已提供带子类型上下文的主按钮，避免桌面端上下双主色按钮重复。
  const showGlobalQuickRecord = !currentItem?.category && currentItem?.id !== 'growth';
  const modSymbol = getShortcutModifierSymbol();

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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="打开快捷操作面板"
                  onClick={() => openCommandPalette(true)}
                  className="hidden h-8 gap-2 px-2.5 text-muted-foreground hover:text-foreground md:inline-flex"
                />
              }
            >
              <Search className="size-3.5" />
              <span className="hidden lg:inline">快捷操作</span>
              <span className="inline-flex items-center gap-0.5">
                <Kbd>{modSymbol}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </TooltipTrigger>
            <TooltipContent>搜索页面或快速记录（{modSymbol}+K）</TooltipContent>
          </Tooltip>

          {showGlobalQuickRecord ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="sm" className="hidden sm:inline-flex" onClick={() => openContextualCreate(pathname)} />
                }
              >
                <PlusIcon className="size-4" />
                <span>记一笔</span>
                <Kbd className="hidden border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground lg:inline-flex">
                  N
                </Kbd>
              </TooltipTrigger>
              <TooltipContent>快速记一笔（快捷键 N）</TooltipContent>
            </Tooltip>
          ) : null}
          <ThemeSwitcher />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
