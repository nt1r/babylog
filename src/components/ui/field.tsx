import type * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('flex flex-col gap-5', className)} {...props} />;
}

function Field({
  className,
  invalid,
  ...props
}: React.ComponentProps<'div'> & {
  invalid?: boolean;
}) {
  return (
    <div
      data-slot="field"
      data-invalid={invalid ? 'true' : undefined}
      className={cn('group/field flex w-full flex-col gap-2', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label data-slot="field-label" className={cn('text-[13px] font-medium text-foreground', className)} {...props} />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-xs leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  if (!children) return null;
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn('text-xs font-medium text-destructive', className)}
      {...props}
    >
      {children}
    </p>
  );
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel };
