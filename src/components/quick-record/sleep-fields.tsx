import { subMinutes } from 'date-fns';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { SleepSubtype } from '@/lib/records';
import { combineLocalDateTimeToISO, formatDurationMin, guessSleepSubtype, splitLocalDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const SLEEP_DURATION_PRESETS = [
  { label: '30 分钟', minutes: 30 },
  { label: '1 小时', minutes: 60 },
  { label: '1.5 小时', minutes: 90 },
  { label: '2 小时', minutes: 120 },
  { label: '8 小时', minutes: 480 },
] as const;

export interface SleepFormState {
  subtype: SleepSubtype;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

interface SleepFieldsProps {
  readonly state: SleepFormState;
  readonly maxDate: string;
  readonly durationMin: number;
  readonly onChange: (patch: Partial<SleepFormState>) => void;
}

export function SleepFields({ state, maxDate, durationMin, onChange }: SleepFieldsProps) {
  // 睡眠补录场景下家长通常是在「宝宝刚睡醒」时记录，因此快捷时长以醒来时间为锚点倒推入睡时间。
  function applyDuration(minutes: number) {
    const endISO = combineLocalDateTimeToISO(state.endDate, state.endTime);
    const endDate = endISO ? new Date(endISO) : new Date();
    const startDate = subMinutes(endDate, minutes);
    const startParts = splitLocalDateTime(startDate);
    onChange({
      startDate: startParts.date,
      startTime: startParts.time,
      subtype: guessSleepSubtype(startDate),
    });
  }

  function setEndNow() {
    const now = new Date();
    const prevDur = durationMin > 0 ? Math.min(durationMin, 720) : 60;
    const endParts = splitLocalDateTime(now);
    const startDate = subMinutes(now, prevDur);
    const startParts = splitLocalDateTime(startDate);
    onChange({
      endDate: endParts.date,
      endTime: endParts.time,
      startDate: startParts.date,
      startTime: startParts.time,
      subtype: guessSleepSubtype(startDate),
    });
  }

  return (
    <FieldGroup className="gap-4">
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">睡眠类型</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: 'nap', label: '白天小睡' },
              { value: 'night', label: '夜间整觉' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange({ subtype: item.value })}
              className={cn(
                'cursor-pointer rounded-xl border py-2.5 text-sm font-medium transition-colors',
                state.subtype === item.value
                  ? 'border-sleep bg-sleep-soft text-sleep-soft-foreground'
                  : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground">快捷时长（从醒来倒推入睡）</p>
          <button
            type="button"
            onClick={setEndNow}
            className="cursor-pointer text-xs font-medium text-primary hover:underline"
          >
            刚醒（设为现在）
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SLEEP_DURATION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyDuration(preset.minutes)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1 text-xs tabular-nums transition-colors',
                durationMin === preset.minutes
                  ? 'border-sleep bg-sleep-soft text-sleep-soft-foreground'
                  : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">入睡时间</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Input
            type="date"
            max={maxDate}
            value={state.startDate}
            aria-label="入睡日期"
            className="tabular-nums"
            onChange={(event) => onChange({ startDate: event.target.value })}
          />
          <Input
            type="time"
            value={state.startTime}
            aria-label="入睡时间"
            className="tabular-nums"
            onChange={(event) => {
              const nextTime = event.target.value;
              const parsed = combineLocalDateTimeToISO(state.startDate, nextTime);
              onChange({
                startTime: nextTime,
                ...(parsed ? { subtype: guessSleepSubtype(new Date(parsed)) } : {}),
              });
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">醒来时间</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Input
            type="date"
            max={maxDate}
            value={state.endDate}
            aria-label="醒来日期"
            className="tabular-nums"
            onChange={(event) => onChange({ endDate: event.target.value })}
          />
          <Input
            type="time"
            value={state.endTime}
            aria-label="醒来时间"
            className="tabular-nums"
            onChange={(event) => onChange({ endTime: event.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2.5 text-xs">
        <span className="text-muted-foreground">预计睡眠时长</span>
        <span className="font-semibold text-foreground tabular-nums">
          {durationMin > 0 ? formatDurationMin(durationMin) : '请调整入睡与醒来时间'}
        </span>
      </div>
    </FieldGroup>
  );
}
