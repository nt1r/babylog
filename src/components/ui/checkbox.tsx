import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        'peer inline-flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-input bg-background/85 text-primary-foreground shadow-2xs transition-all duration-150 outline-none hover:border-primary/65 hover:bg-accent/45 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 active:scale-95 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-checked:hover:border-primary data-checked:hover:bg-primary/90 data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-input/30 dark:data-checked:border-primary dark:data-checked:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {indeterminate ? (
          <MinusIcon className="size-3" strokeWidth={2.75} />
        ) : (
          <CheckIcon className="size-3" strokeWidth={2.75} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
