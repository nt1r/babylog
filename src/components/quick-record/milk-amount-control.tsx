import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface MilkAmountControlProps {
  readonly valueText: string;
  readonly onChange: (nextText: string) => void;
  readonly presets: readonly number[];
}

/** 奶量步进器 + 高频档位快捷胶囊；输入框以字符串受控，保证退格删空重输时不会卡住。 */
export function MilkAmountControl({ valueText, onChange, presets }: MilkAmountControlProps) {
  const parsed = Number.parseInt(valueText, 10);
  const currentNum = Number.isNaN(parsed) ? 0 : parsed;

  function stepBy(delta: number) {
    const base = currentNum > 0 ? currentNum : 90;
    const next = Math.max(10, Math.min(1000, base + delta));
    onChange(String(next));
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-medium text-foreground">奶量（ml）</p>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" className="px-2.5 tabular-nums" onClick={() => stepBy(-30)}>
          -30
        </Button>
        <Button type="button" variant="outline" size="sm" className="px-2.5 tabular-nums" onClick={() => stepBy(-10)}>
          -10
        </Button>
        <Input
          type="number"
          min={1}
          max={1000}
          inputMode="numeric"
          value={valueText}
          placeholder="如 120"
          aria-label="奶量毫升数"
          className="text-center text-base font-semibold tabular-nums"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button type="button" variant="outline" size="sm" className="px-2.5 tabular-nums" onClick={() => stepBy(10)}>
          +10
        </Button>
        <Button type="button" variant="outline" size="sm" className="px-2.5 tabular-nums" onClick={() => stepBy(30)}>
          +30
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => onChange(String(ml))}
            className={cn(
              'cursor-pointer rounded-full border px-3 py-1 text-xs tabular-nums transition-colors',
              currentNum === ml
                ? 'border-feeding bg-feeding-soft text-feeding-soft-foreground'
                : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
            )}
          >
            {ml} ml
          </button>
        ))}
      </div>
    </div>
  );
}
