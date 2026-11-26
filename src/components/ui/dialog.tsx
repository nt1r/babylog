import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DialogPendingContext = React.createContext(false);

interface DialogProps extends DialogPrimitive.Root.Props {
  /** 提交或删除进行中时设为 true：自动禁用遮罩关闭、拦截 Esc 退出并禁用顶部关闭按钮。 */
  pending?: boolean;
}

function Dialog({ pending = false, disablePointerDismissal, onOpenChange, ...props }: DialogProps) {
  return (
    <DialogPendingContext.Provider value={pending}>
      <DialogPrimitive.Root
        data-slot="dialog"
        disablePointerDismissal={pending || disablePointerDismissal}
        onOpenChange={(nextOpen, eventDetails) => {
          if (!nextOpen && pending) {
            eventDetails.cancel();
            return;
          }
          onOpenChange?.(nextOpen, eventDetails);
        }}
        {...props}
      />
    </DialogPendingContext.Provider>
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-foreground/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-[2px]',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  const pending = React.useContext(DialogPendingContext);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border/80 bg-popover p-5 text-sm text-popover-foreground shadow-xl outline-none transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            disabled={pending}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                aria-label="关闭弹窗"
              />
            }
          >
            <XIcon className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-xs leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
