import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const toastManager = ToastPrimitive.createToastManager();

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-100 mx-auto flex w-auto max-w-sm flex-col gap-2 outline-none md:right-4 md:bottom-4 md:left-auto md:mx-0 md:w-full"
    >
      {toasts.map((item) => {
        const type = item.type ?? 'info';
        const Icon =
          type === 'success'
            ? CircleCheckIcon
            : type === 'error'
              ? OctagonXIcon
              : type === 'warning'
                ? TriangleAlertIcon
                : InfoIcon;

        return (
          <ToastPrimitive.Root
            key={item.id}
            toast={item}
            data-slot="toast"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-border/80 bg-popover p-3.5 text-popover-foreground shadow-lg transition-all duration-200 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                type === 'success' && 'text-success',
                type === 'error' && 'text-destructive',
                type === 'warning' && 'text-warning',
                type === 'info' && 'text-primary',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              {item.title ? (
                <ToastPrimitive.Title className="text-sm font-medium">{item.title}</ToastPrimitive.Title>
              ) : null}
              {item.description ? (
                <ToastPrimitive.Description className="text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground"
                  aria-label="关闭通知"
                />
              }
            >
              <XIcon className="size-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
    </ToastPrimitive.Viewport>
  );
}

function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} timeout={3600}>
      <ToastPrimitive.Portal>
        <ToastList />
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

const toast = {
  success: (title: string, description?: string) => toastManager.add({ title, description, type: 'success' }),
  error: (title: string, description?: string) => toastManager.add({ title, description, type: 'error' }),
  warning: (title: string, description?: string) => toastManager.add({ title, description, type: 'warning' }),
  info: (title: string, description?: string) => toastManager.add({ title, description, type: 'info' }),
};

export { Toaster, toast };
