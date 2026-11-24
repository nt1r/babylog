import { Input as InputPrimitive } from '@base-ui/react/input';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, onWheel, ...props }: React.ComponentProps<'input'>) {
  function handleWheel(event: React.WheelEvent<HTMLInputElement>) {
    // 桌面端滚轮浏览表单/抽屉时，阻止聚焦态 number 输入框意外递增或递减数值。
    if (type === 'number' && document.activeElement === event.currentTarget) {
      event.currentTarget.blur();
    }
    onWheel?.(event);
  }

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      onWheel={handleWheel}
      className={cn(
        'h-10 w-full min-w-0 rounded-xl border border-input bg-background/60 px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/25',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
