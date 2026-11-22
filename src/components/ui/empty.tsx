import type * as React from 'react';
import { cn } from '@/lib/utils';

function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/80 bg-muted/25 px-6 py-12 text-center',
        className,
      )}
      {...props}
    />
  );
}

function EmptyMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-media"
      className={cn('flex items-center justify-center text-muted-foreground', className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 data-slot="empty-title" className={cn('text-base font-semibold text-foreground', className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-description"
      className={cn('max-w-sm text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

function EmptyActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-actions"
      className={cn('flex flex-wrap items-center justify-center gap-2', className)}
      {...props}
    />
  );
}

export { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle };
