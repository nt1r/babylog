import { QuickChip } from '@/components/ui/choice-controls';
import { STOOL_COLOR_LABELS, STOOL_CONSISTENCY_LABELS, type StoolColor, type StoolConsistency } from '@/lib/records';
import { cn } from '@/lib/utils';

interface StoolObservationPanelProps {
  readonly stoolConsistency: StoolConsistency | '';
  readonly stoolColor: StoolColor | '';
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onChange: (patch: { stoolConsistency?: StoolConsistency | ''; stoolColor?: StoolColor | '' }) => void;
}

/** 便便性状与颜色可选观察面板（含「正常：软便 · 黄色」一键胶囊），供单条护理与批量补录复用。 */
export function StoolObservationPanel({
  stoolConsistency,
  stoolColor,
  disabled = false,
  className,
  onChange,
}: StoolObservationPanelProps) {
  const isNormal = stoolConsistency === 'soft' && stoolColor === 'yellow';

  return (
    <div className={cn('space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">便便观察（可选）</p>
        <QuickChip
          tone="care"
          variant="outline"
          disabled={disabled}
          active={isNormal}
          onClick={() =>
            onChange({
              stoolConsistency: isNormal ? '' : 'soft',
              stoolColor: isNormal ? '' : 'yellow',
            })
          }
        >
          正常（软便 · 黄色）
        </QuickChip>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">便便性状（可选）</p>
        <div className="flex flex-wrap gap-1.5">
          {(['watery', 'soft', 'formed', 'hard'] as const).map((c) => (
            <QuickChip
              key={c}
              tone="care"
              disabled={disabled}
              active={stoolConsistency === c}
              onClick={() => onChange({ stoolConsistency: stoolConsistency === c ? '' : c })}
            >
              {STOOL_CONSISTENCY_LABELS[c]}
            </QuickChip>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">便便颜色（可选）</p>
        <div className="flex flex-wrap gap-1.5">
          {(['yellow', 'green', 'brown', 'abnormal'] as const).map((color) => (
            <QuickChip
              key={color}
              tone={color === 'abnormal' ? 'destructive' : 'care'}
              disabled={disabled}
              active={stoolColor === color}
              onClick={() => onChange({ stoolColor: stoolColor === color ? '' : color })}
            >
              {STOOL_COLOR_LABELS[color]}
            </QuickChip>
          ))}
        </div>
      </div>
    </div>
  );
}
