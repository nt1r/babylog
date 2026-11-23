import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { MenuIcon, PanelLeftIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const SIDEBAR_STORAGE_KEY = 'babylog_sidebar_open';
const SIDEBAR_WIDTH = '15.5rem';
const SIDEBAR_WIDTH_ICON = '3.5rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

interface SidebarContextProps {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean | ((value: boolean) => boolean)) => void;
  openMobile: boolean;
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }
  return context;
}

function readInitialSidebarOpen(defaultOpen: boolean): boolean {
  if (typeof window === 'undefined') return defaultOpen;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // 忽略本地存储读取异常，回退到默认展开状态
  }
  return defaultOpen;
}

function SidebarProvider({
  defaultOpen = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [open, setOpenState] = React.useState(() => readInitialSidebarOpen(defaultOpen));

  const setOpen = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setOpenState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // 忽略本地存储写入异常，保持内存态折叠切换可用
      }
      return next;
    });
  }, []);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev);
    } else {
      setOpen((prev) => !prev);
    }
  }, [isMobile, setOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? 'expanded' : 'collapsed';

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width': SIDEBAR_WIDTH,
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn('group/sidebar-wrapper flex min-h-svh w-full bg-sidebar', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({ className, children, ...props }: React.ComponentProps<'aside'>) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" showCloseButton={false} className="w-[17rem] bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>导航菜单</SheetTitle>
            <SheetDescription>切换 BabyLog 功能模块</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
      className="group peer hidden text-sidebar-foreground md:block"
    >
      <div
        className={cn(
          'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-out',
          'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
        )}
      />
      <aside
        data-slot="sidebar-container"
        className={cn(
          'fixed inset-y-0 left-0 z-20 flex h-svh w-(--sidebar-width) flex-col p-2 transition-[width] duration-200 ease-out',
          'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
          className,
        )}
        {...props}
      >
        <div className="flex h-full w-full flex-col overflow-hidden">{children}</div>
      </aside>
    </div>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        'relative flex min-h-svh w-full min-w-0 flex-1 flex-col bg-background md:m-2 md:ml-0 md:min-h-[calc(100svh-1rem)] md:rounded-2xl md:border md:border-border/75 md:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { isMobile, toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn('text-muted-foreground hover:text-foreground', className)}
      aria-label={isMobile ? '打开导航菜单' : '展开或收起侧边栏'}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      {isMobile ? <MenuIcon className="size-4.5" /> : <PanelLeftIcon className="size-4" />}
    </Button>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('mt-auto flex flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-1 group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('flex flex-col gap-1', className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'px-2.5 py-1 text-xs font-medium text-muted-foreground/85 transition-opacity duration-150 group-data-[collapsible=icon]:sr-only',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative', className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  'flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2 text-left text-sm font-medium text-sidebar-foreground/85 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 [&>svg]:size-4 [&>svg]:shrink-0 [&>span:last-child]:truncate group-data-[collapsible=icon]:[&>span]:hidden',
  {
    variants: {
      size: {
        default: 'h-9',
        lg: 'h-11',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

function SidebarMenuButton({
  render,
  isActive = false,
  tooltip,
  size = 'default',
  className,
  ...props
}: useRender.ComponentProps<'button'> &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    isActive?: boolean;
    tooltip?: string;
  }) {
  const { isMobile, state } = useSidebar();

  const button = useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(sidebarMenuButtonVariants({ size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-button',
      active: isActive,
    },
  });

  if (!tooltip || isMobile || state !== 'collapsed') {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right" align="center">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="sidebar-separator" className={cn('bg-sidebar-border', className)} {...props} />;
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
