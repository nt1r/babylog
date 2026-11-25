import { PlusIcon, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { InfoPopover } from '@/components/ui/info-popover';
import { Input } from '@/components/ui/input';
import {
  type EditableDoseRow,
  MAX_AGE_MONTHS,
  MAX_EDITABLE_DOSES,
  nextDoseRowKey,
} from '@/components/vaccines/vaccine-codec';

interface DoseScheduleEditorProps {
  readonly rows: readonly EditableDoseRow[];
  readonly disabled?: boolean;
  readonly onChange: (nextRows: EditableDoseRow[]) => void;
  readonly onResetDefaults?: () => void;
}

/**
 * 可复用的疫苗剂次排期编辑器（供自费模板定制与自定义多剂次疫苗共用）：
 * 序号始终按数组位置自动生成 1..N，删除任意中间剂次后，后续剂次自动依次前移补位。
 */
export function DoseScheduleEditor({ rows, disabled, onChange, onResetDefaults }: DoseScheduleEditorProps) {
  function handleAddRow() {
    if (rows.length >= MAX_EDITABLE_DOSES || disabled) return;
    const lastAge = Number.parseInt(rows[rows.length - 1]?.ageMonths ?? '2', 10);
    const nextAge = Number.isFinite(lastAge) ? Math.min(MAX_AGE_MONTHS, lastAge + 1) : 2;
    onChange([
      ...rows,
      {
        key: nextDoseRowKey(),
        ageMonths: String(nextAge),
        plannedDate: '',
      },
    ]);
  }

  function handleUpdateRow(index: number, patch: Partial<Pick<EditableDoseRow, 'ageMonths' | 'plannedDate'>>) {
    onChange(rows.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  }

  function handleRemoveRow(index: number) {
    if (rows.length <= 1 || disabled) return;
    onChange(rows.filter((_, idx) => idx !== index));
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[13px] font-medium text-foreground tabular-nums">接种排期（共 {rows.length} 剂）</span>
          <InfoPopover title="排期调整说明" ariaLabel="查看排期调整说明" disabled={disabled}>
            <p>
              填写适龄月龄后会自动按宝宝出生日期推算预计接种日，也可按门诊通知手动指定日期；删除任意中间剂次时，后续剂次序号将自动顺延补齐。
            </p>
          </InfoPopover>
        </div>
        <div className="flex items-center gap-1.5">
          {onResetDefaults ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onResetDefaults}
            >
              <RotateCcw className="size-3" />
              恢复默认
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || rows.length >= MAX_EDITABLE_DOSES}
            className="h-7 px-2.5 text-xs"
            onClick={handleAddRow}
          >
            <PlusIcon className="size-3.5" />
            增加一剂
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.key} className="rounded-xl border border-border/75 bg-muted/25 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                第 {index + 1} 剂
              </Badge>

              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_AGE_MONTHS}
                  aria-label={`第 ${index + 1} 剂适龄月龄`}
                  disabled={disabled}
                  value={row.ageMonths}
                  onChange={(e) => handleUpdateRow(index, { ageMonths: e.target.value })}
                  className="h-8 w-20 rounded-lg px-2 text-base tabular-nums md:text-[13px]"
                />
                <span className="text-xs text-muted-foreground">月龄</span>
              </div>

              <DatePicker
                size="sm"
                clearable
                placeholder="默认推算"
                ariaLabel={`第 ${index + 1} 剂预计日期（可选）`}
                drawerTitle={`第 ${index + 1} 剂预计日期`}
                disabled={disabled}
                value={row.plannedDate}
                onChange={(nextDate) => handleUpdateRow(index, { plannedDate: nextDate })}
                className="min-w-32 flex-1 sm:max-w-44"
              />

              <div className="ml-auto flex items-center gap-0.5">
                {row.tip ? (
                  <InfoPopover
                    title={`第 ${index + 1} 剂参考说明`}
                    ariaLabel={`查看第 ${index + 1} 剂参考说明`}
                    tone="info"
                    align="end"
                    disabled={disabled}
                    triggerClassName="size-8"
                  >
                    <p className="text-foreground">{row.tip}</p>
                  </InfoPopover>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除第 ${index + 1} 剂`}
                  disabled={disabled || rows.length <= 1}
                  onClick={() => handleRemoveRow(index)}
                  className="size-8 shrink-0 text-muted-foreground hover:bg-destructive-soft hover:text-destructive disabled:opacity-35"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
