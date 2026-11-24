import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface EntityDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 提交或删除进行中时为 true：禁用顶部关闭按钮并通过 eventDetails.cancel() 拦截遮罩、Esc、返回键与下滑关闭。 */
  readonly pending?: boolean;
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly badge?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 通用实体抽屉容器：桌面端从右侧滑出，移动端从底部滑出并支持嵌套抽屉堆栈（如内部打开 DatePicker / TimePicker）。
 */
export function EntityDrawer({
  open,
  onOpenChange,
  pending = false,
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
    <Drawer
      open={open}
      disablePointerDismissal={pending}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && pending) {
          eventDetails.cancel();
          return;
        }
        onOpenChange(nextOpen);
      }}
      swipeDirection={isMobile ? 'down' : 'right'}
      showSwipeHandle={isMobile}
    >
      <DrawerContent className={cn(isMobile ? 'max-h-[90dvh]' : 'w-full md:max-w-md', className)}>
        <DrawerHeader className="relative pr-12">
          <div className="flex items-center gap-2">
            {icon ? <span className="text-primary">{icon}</span> : null}
            <DrawerTitle>{title}</DrawerTitle>
            {badge}
          </div>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          <DrawerClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                className="absolute top-3.5 right-3.5"
                aria-label="关闭面板"
              />
            }
          >
            <XIcon className="size-4" />
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <DrawerFooter className={cn(isMobile && 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]')}>
            {footer}
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
