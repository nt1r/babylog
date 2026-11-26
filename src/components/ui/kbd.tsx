import type * as React from 'react';
import { cn } from '@/lib/utils';

/** 键盘快捷键徽标原语：统一等宽细边框质感，字号遵守全站不低于 12px 规范。 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-md border border-border/80 bg-muted/70 px-1.5 font-sans text-xs font-medium text-muted-foreground select-none',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
