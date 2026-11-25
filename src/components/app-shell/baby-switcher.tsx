import { Baby, CheckIcon, ChevronsUpDown, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { AddBabyDialog } from '@/components/baby/add-baby-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { toast } from '@/components/ui/toast';
import { MAX_BABIES_PER_USER, useActiveBaby } from '@/lib/baby';
import { formatBabyAge } from '@/lib/time';
import { getInitials } from '@/lib/utils';

interface BabySwitcherProps {
  readonly variant: 'sidebar' | 'header';
}

/**
 * 全局多宝宝切换器：
 * - `sidebar` 变体嵌入侧边栏头部，支持桌面折叠态（单图标 + Tooltip）与展开态；
 * - `header` 变体嵌入移动端顶栏，支持单手快速切娃或添加宝宝。
 */
export function BabySwitcher({ variant }: BabySwitcherProps) {
  const { babies, activeBaby, activeBabyId, selectBaby } = useActiveBaby();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const [addOpen, setAddOpen] = useState(false);

  const atLimit = babies.length >= MAX_BABIES_PER_USER;
  const ageLabel = activeBaby ? formatBabyAge(activeBaby.birth_date).ageLabel : '暂未创建宝宝档案';

  function handleSelect(babyId: number, nickname: string) {
    if (babyId === activeBabyId) {
      if (variant === 'sidebar') setOpenMobile(false);
      return;
    }
    selectBaby(babyId);
    if (variant === 'sidebar') setOpenMobile(false);
    toast.success(`已切换至 ${nickname}`);
  }

  function handleOpenAdd() {
    if (variant === 'sidebar') setOpenMobile(false);
    setAddOpen(true);
  }

  if (variant === 'header') {
    // 移动端顶栏空间紧凑，仅在多娃家庭展示快捷切娃胶囊；单娃家庭在侧边栏与首页名片中已清晰可见。
    if (!activeBaby || babies.length <= 1) return null;
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 max-w-36 gap-1.5 rounded-full px-2 md:hidden"
                aria-label={`当前宝宝：${activeBaby.nickname}，点击切换`}
              />
            }
          >
            <Avatar className="size-5 bg-primary/15 text-primary">
              <AvatarFallback className="text-xs">{Array.from(activeBaby.nickname)[0] ?? '宝'}</AvatarFallback>
            </Avatar>
            <span className="truncate text-xs font-medium text-foreground">{activeBaby.nickname}</span>
            <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>切换宝宝档案</DropdownMenuLabel>
            <DropdownMenuGroup>
              {babies.map((baby) => {
                const selected = baby.id === activeBabyId;
                const babyAge = formatBabyAge(baby.birth_date).ageLabel;
                return (
                  <DropdownMenuItem key={baby.id} onClick={() => handleSelect(baby.id, baby.nickname)}>
                    <Avatar className="size-6 bg-primary/12 text-primary">
                      <AvatarFallback className="text-xs">{getInitials(baby.nickname)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{baby.nickname}</p>
                      <p className="truncate text-xs text-muted-foreground">{babyAge}</p>
                    </div>
                    {selected ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={atLimit} onClick={handleOpenAdd}>
              <PlusIcon className="size-4" />
              {atLimit ? `已达 ${MAX_BABIES_PER_USER} 个宝宝上限` : '添加宝宝'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AddBabyDialog open={addOpen} onOpenChange={setAddOpen} currentCount={babies.length} />
      </>
    );
  }

  const isDesktopCollapsed = !isMobile && state === 'collapsed';

  if (!activeBaby) {
    return (
      <>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="添加宝宝档案"
              onClick={handleOpenAdd}
              className="gap-2.5 border border-dashed border-border/80 bg-muted/35 text-muted-foreground hover:text-foreground"
            >
              <PlusIcon className="size-4 shrink-0 text-primary" />
              <span data-slot="sidebar-label" className="truncate text-xs font-medium">
                添加宝宝档案
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <AddBabyDialog open={addOpen} onOpenChange={setAddOpen} currentCount={babies.length} />
      </>
    );
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  tooltip={`当前宝宝：${activeBaby.nickname}`}
                  aria-label={`当前宝宝：${activeBaby.nickname}，点击切换或添加宝宝`}
                  className="gap-2.5 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/40 px-2 hover:bg-sidebar-accent"
                />
              }
            >
              {isDesktopCollapsed ? (
                <Baby className="size-4 shrink-0 text-primary" strokeWidth={1.9} />
              ) : (
                <Avatar className="size-7 shrink-0 rounded-lg bg-primary/15 text-primary">
                  <AvatarFallback className="rounded-lg text-xs font-semibold">
                    {getInitials(activeBaby.nickname)}
                  </AvatarFallback>
                </Avatar>
              )}
              <span data-slot="sidebar-label" className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="truncate text-sm font-semibold text-foreground">{activeBaby.nickname}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">{ageLabel}</span>
              </span>
              <ChevronsUpDown
                data-slot="sidebar-label"
                className="ml-auto size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" side={isDesktopCollapsed ? 'right' : 'bottom'} className="min-w-60">
              <DropdownMenuLabel>
                {babies.length >= MAX_BABIES_PER_USER - 2
                  ? `切换宝宝（${babies.length} / ${MAX_BABIES_PER_USER}）`
                  : '切换宝宝'}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                {babies.map((baby) => {
                  const selected = baby.id === activeBabyId;
                  const babyAge = formatBabyAge(baby.birth_date).ageLabel;
                  return (
                    <DropdownMenuItem key={baby.id} onClick={() => handleSelect(baby.id, baby.nickname)}>
                      <Avatar className="size-7 rounded-lg bg-primary/12 text-primary">
                        <AvatarFallback className="rounded-lg text-xs">{getInitials(baby.nickname)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{baby.nickname}</p>
                        <p className="truncate text-xs text-muted-foreground">{babyAge}</p>
                      </div>
                      {selected ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={atLimit} onClick={handleOpenAdd}>
                <PlusIcon className="size-4" />
                {atLimit ? `已达 ${MAX_BABIES_PER_USER} 个宝宝上限` : '添加宝宝'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <AddBabyDialog open={addOpen} onOpenChange={setAddOpen} currentCount={babies.length} />
    </>
  );
}
