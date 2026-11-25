import { Link, useRouterState } from '@tanstack/react-router';
import { BabySwitcher } from '@/components/app-shell/baby-switcher';
import { BrandMark } from '@/components/brand/brand-mark';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useActiveBabyId } from '@/lib/baby';
import { cn } from '@/lib/utils';
import { computeVaccineAttentionBadge, useVaccinesOverviewQuery, VACCINE_OVERVIEW_STALE_MS } from '@/lib/vaccines';
import { getVisibleNavGroups, isAccountLevelRoute } from '@/navigation/menu';
import { useAuthStore } from '@/stores/auth';

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useAuthStore((state) => state.user);
  const activeBabyId = useActiveBabyId();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const vaccinesQuery = useVaccinesOverviewQuery(activeBabyId !== null, VACCINE_OVERVIEW_STALE_MS);

  const visibleNavGroups = getVisibleNavGroups(user?.role);
  const { count: vaccineAttentionCount, urgent: vaccineBadgeUrgent } = computeVaccineAttentionBadge(
    vaccinesQuery.data?.summary,
  );
  const isDesktopCollapsed = !isMobile && state === 'collapsed';

  return (
    <Sidebar>
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="BabyLog"
              render={
                <Link to={activeBabyId !== null ? '/dashboard' : '/settings'} onClick={() => setOpenMobile(false)} />
              }
              className="gap-2.5 px-2"
            >
              <BrandMark className="size-7 shrink-0 text-primary" />
              <span data-slot="sidebar-label" className="flex flex-col leading-tight">
                <span className="text-[15px] font-bold tracking-tight text-foreground">
                  Baby<span className="font-medium">Log</span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">宝宝成长记录</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <BabySwitcher variant="sidebar" />
      </SidebarHeader>

      <SidebarContent>
        {visibleNavGroups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.url || pathname.startsWith(`${item.url}/`);
                const requiresBaby = activeBabyId === null && !isAccountLevelRoute(item.url);
                const showVaccineBadge = item.id === 'vaccines' && activeBabyId !== null && vaccineAttentionCount > 0;
                const tooltipText = requiresBaby
                  ? `${item.title}（需先添加宝宝档案）`
                  : showVaccineBadge
                    ? `${item.title}（${vaccineAttentionCount} 项待关注）`
                    : item.title;

                return (
                  <SidebarMenuItem key={item.id} className="relative flex items-center">
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={tooltipText}
                      render={<Link to={item.url} onClick={() => setOpenMobile(false)} />}
                      className={cn(
                        showVaccineBadge && !isDesktopCollapsed && 'pr-9',
                        requiresBaby && 'text-muted-foreground/75',
                      )}
                    >
                      <Icon strokeWidth={1.8} />
                      <span data-slot="sidebar-label">{item.title}</span>
                    </SidebarMenuButton>

                    {showVaccineBadge && isDesktopCollapsed ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-sidebar',
                          vaccineBadgeUrgent ? 'bg-destructive' : 'bg-warning',
                        )}
                      />
                    ) : null}

                    {showVaccineBadge ? (
                      <SidebarMenuBadge
                        aria-label={`${vaccineAttentionCount} 项待关注疫苗`}
                        className={
                          vaccineBadgeUrgent
                            ? 'bg-destructive-soft text-destructive-soft-foreground'
                            : 'bg-warning-soft text-warning-soft-foreground'
                        }
                      >
                        {vaccineAttentionCount > 9 ? '9+' : vaccineAttentionCount}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
