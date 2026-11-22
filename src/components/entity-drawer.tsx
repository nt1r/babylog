import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface EntityDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly badge?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 通用实体抽屉容器：桌面端从右侧滑出，移动端从底部滑出，方便单手操作。
 */
export function EntityDrawer({
  open,
  onOpenChange,
  title,
  description,
  icon,
  badge,
  footer,
  className,
  children,
}: EntityDrawerProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(isMobile ? 'max-h-[90dvh]' : 'w-full sm:max-w-md', className)}
      >
        <SheetHeader className="pr-12">
          <div className="flex items-center gap-2">
            {icon ? <span className="text-primary">{icon}</span> : null}
            <SheetTitle>{title}</SheetTitle>
            {badge}
          </div>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
