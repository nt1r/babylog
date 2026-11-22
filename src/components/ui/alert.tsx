import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  "group/alert relative grid w-full gap-1 rounded-xl border px-3.5 py-3 text-left text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        destructive:
          'border-destructive/20 bg-destructive-soft text-destructive-soft-foreground *:data-[slot=alert-description]:text-destructive-soft-foreground/90',
        warning:
          'border-warning/25 bg-warning-soft text-warning-soft-foreground *:data-[slot=alert-description]:text-warning-soft-foreground/90',
        success:
          'border-success/20 bg-success-soft text-success-soft-foreground *:data-[slot=alert-description]:text-success-soft-foreground/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('text-[13px] leading-relaxed font-medium group-has-[>svg]/alert:col-start-2', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-xs leading-relaxed text-muted-foreground group-has-[>svg]/alert:col-start-2', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
