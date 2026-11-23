import { Link, useRouterState } from '@tanstack/react-router';
import { BrandMark } from '@/components/brand/brand-mark';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { NAV_GROUPS } from '@/navigation/menu';

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="BabyLog"
              render={<Link to="/dashboard" onClick={() => setOpenMobile(false)} />}
              className="gap-2.5 px-2"
            >
              <BrandMark className="size-7 shrink-0 text-primary" />
              <span className="flex flex-col leading-tight">
                <span className="text-[15px] font-bold tracking-tight text-foreground">
                  Baby<span className="font-medium">Log</span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">宝宝成长记录</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.url || pathname.startsWith(`${item.url}/`);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={<Link to={item.url} onClick={() => setOpenMobile(false)} />}
                    >
                      <Icon strokeWidth={1.8} />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
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
