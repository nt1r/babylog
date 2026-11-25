import { Link, useRouterState } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getContextualCreateAriaLabel, MOBILE_NAV_ITEMS, openContextualCreate } from '@/navigation/menu';

export function MobileTabBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const createAriaLabel = getContextualCreateAriaLabel(pathname);

  const leftItems = MOBILE_NAV_ITEMS.slice(0, 2);
  const rightItems = MOBILE_NAV_ITEMS.slice(2, 4);

  return (
    <nav
      aria-label="移动端底部导航"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-background/95 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-center">
        {leftItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.url;
          return (
            <Link
              key={item.id}
              to={item.url}
              className={cn(
                'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2 : 1.75} />
              <span>{item.shortTitle}</span>
            </Link>
          );
        })}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => openContextualCreate(pathname)}
            aria-label={createAriaLabel}
            className="flex size-11 cursor-pointer items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95"
          >
            <PlusIcon className="size-5" strokeWidth={2.2} />
          </button>
        </div>

        {rightItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.url;
          return (
            <Link
              key={item.id}
              to={item.url}
              className={cn(
                'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2 : 1.75} />
              <span>{item.shortTitle}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
