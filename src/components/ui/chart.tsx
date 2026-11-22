import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    color?: string;
  }
>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  const cssVars = React.useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [key, item] of Object.entries(config)) {
      if (item.color) {
        vars[`--color-${key}`] = item.color;
      }
    }
    return vars as React.CSSProperties;
  }, [config]);

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        style={cssVars}
        className={cn(
          "flex aspect-video w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/60 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/50 [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
  color?: string;
}

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  unit,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  className?: string;
  unit?: string;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  return (
    <div
      className={cn(
        'grid min-w-36 gap-1.5 rounded-xl border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md',
        className,
      )}
    >
      {label !== undefined ? <div className="font-medium text-foreground">{label}</div> : null}
      <div className="grid gap-1">
        {payload.map((entry, idx) => {
          const key = String(entry.dataKey ?? entry.name ?? idx);
          const itemConfig = config[key];
          const color = entry.color ?? itemConfig?.color ?? 'var(--primary)';
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                {itemConfig?.label ?? entry.name ?? key}
              </span>
              <span className="font-medium text-foreground tabular-nums">
                {entry.value}
                {unit ? ` ${unit}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent };
