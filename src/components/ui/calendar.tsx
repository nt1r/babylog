import { format } from 'date-fns';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import * as React from 'react';
import { type ChevronProps, type DayButton, DayPicker, getDefaultClassNames, type RootProps } from 'react-day-picker';
import { zhCN } from 'react-day-picker/locale';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const WEEKDAY_SHORT_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

function CalendarRoot({ className, rootRef, ...props }: RootProps) {
  return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
}

function CalendarChevron({ className, orientation, ...props }: ChevronProps) {
  if (orientation === 'left') {
    return <ChevronLeftIcon className={cn('size-4', className)} {...props} />;
  }
  if (orientation === 'right') {
    return <ChevronRightIcon className={cn('size-4', className)} {...props} />;
  }
  return <ChevronDownIcon className={cn('size-3.5', className)} {...props} />;
}

function CalendarWeekNumber({ children, ...props }: React.ComponentProps<'td'>) {
  return (
    <td {...props}>
      <div className="flex size-(--cell-size) items-center justify-center text-center">{children}</div>
    </td>
  );
}

function CalendarDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={format(day.date, 'yyyy-MM-dd')}
      data-selected-single={
        modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal tabular-nums group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-3 group-data-[focused=true]/day:ring-ring/25 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-end=true]:hover:bg-primary/90 data-[range-end=true]:hover:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-start=true]:hover:bg-primary/90 data-[range-start=true]:hover:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:font-medium data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:hover:bg-primary/90 data-[selected-single=true]:hover:text-primary-foreground [&>span]:text-xs [&>span]:opacity-70',
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

// 顶层稳定组件映射，防止每次渲染生成新函数引用导致 DayPicker 整树重建并丢失翻月/下拉焦点。
const DEFAULT_CALENDAR_COMPONENTS = {
  Root: CalendarRoot,
  Chevron: CalendarChevron,
  DayButton: CalendarDayButton,
  WeekNumber: CalendarWeekNumber,
} satisfies React.ComponentProps<typeof DayPicker>['components'];

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  locale = zhCN,
  weekStartsOn = 1,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
}) {
  const defaultClassNames = getDefaultClassNames();
  const mergedComponents = React.useMemo(
    () => (components ? { ...DEFAULT_CALENDAR_COMPONENTS, ...components } : DEFAULT_CALENDAR_COMPONENTS),
    [components],
  );

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      className={cn(
        'group/calendar bg-background p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(8)] in-data-[slot=card-content]:bg-transparent in-data-[slot=drawer-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent',
        className,
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatCaption: (date) => format(date, 'yyyy年M月', { locale: zhCN }),
        formatMonthDropdown: (date) => `${date.getMonth() + 1}月`,
        formatYearDropdown: (date) => `${date.getFullYear()}年`,
        formatWeekdayName: (date) => WEEKDAY_SHORT_CN[date.getDay()] ?? '',
        ...formatters,
      }}
      classNames={{
        root: cn('w-fit', defaultClassNames.root),
        months: cn('relative flex flex-col gap-4 md:flex-row', defaultClassNames.months),
        month: cn('flex w-full flex-col gap-3', defaultClassNames.month),
        nav: cn('absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1', defaultClassNames.nav),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 select-none aria-disabled:opacity-40',
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 select-none aria-disabled:opacity-40',
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium tabular-nums',
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          'relative rounded-lg border border-border/80 bg-background/80 transition-colors hover:bg-accent/60 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/25',
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn(
          'absolute inset-0 cursor-pointer bg-popover text-base opacity-0 md:text-sm',
          defaultClassNames.dropdown,
        ),
        caption_label: cn(
          'font-semibold text-foreground tabular-nums select-none',
          captionLayout === 'label'
            ? 'text-sm'
            : 'flex h-7 items-center gap-1 rounded-lg px-2 text-sm font-medium [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
          defaultClassNames.caption_label,
        ),
        month_grid: cn('w-full border-collapse', defaultClassNames.month_grid),
        weekdays: cn('flex', defaultClassNames.weekdays),
        weekday: cn(
          'flex-1 rounded-(--cell-radius) text-xs font-medium text-muted-foreground select-none',
          defaultClassNames.weekday,
        ),
        week: cn('mt-1.5 flex w-full', defaultClassNames.week),
        week_number_header: cn('w-(--cell-size) select-none', defaultClassNames.week_number_header),
        week_number: cn('text-xs text-muted-foreground select-none', defaultClassNames.week_number),
        day: cn(
          'group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)',
          props.showWeekNumber
            ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)'
            : '[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)',
          defaultClassNames.day,
        ),
        range_start: cn(
          'relative isolate z-0 rounded-l-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-muted',
          defaultClassNames.range_start,
        ),
        range_middle: cn('rounded-none', defaultClassNames.range_middle),
        range_end: cn(
          'relative isolate z-0 rounded-r-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-muted',
          defaultClassNames.range_end,
        ),
        today: cn(
          'rounded-(--cell-radius) bg-accent/80 font-semibold text-accent-foreground data-[selected=true]:bg-transparent',
          defaultClassNames.today,
        ),
        outside: cn('text-muted-foreground/55 aria-selected:text-muted-foreground', defaultClassNames.outside),
        disabled: cn('text-muted-foreground/40 opacity-50', defaultClassNames.disabled),
        hidden: cn('invisible', defaultClassNames.hidden),
        ...classNames,
      }}
      components={mergedComponents}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
