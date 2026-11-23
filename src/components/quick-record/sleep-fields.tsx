import { subMinutes } from 'date-fns';
import { DateTimeInputRow } from '@/components/quick-record/date-time-input-row';
import { QuickChip, SegmentedControl } from '@/components/quick-record/record-controls';
import { FieldGroup } from '@/components/ui/field';
import type { SleepSubtype } from '@/lib/records';
import { combineLocalDateTimeToISO, formatDurationMin, guessSleepSubtype, splitLocalDateTime } from '@/lib/time';

const SLEEP_SUBTYPE_OPTIONS = [
  { value: 'nap', label: '白天小睡' },
  { value: 'night', label: '夜间整觉' },
] as const;

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
  readonly subtypeLocked: boolean;
  readonly onSubtypeSelect: (subtype: SleepSubtype) => void;
  readonly onChange: (patch: Partial<SleepFormState>) => void;
}

export function SleepFields({
  state,
  maxDate,
  durationMin,
  subtypeLocked,
  onSubtypeSelect,
  onChange,
}: SleepFieldsProps) {
  // 睡眠补录场景下家长通常是在「宝宝刚睡醒」时记录，因此快捷时长以醒来时间为锚点倒推入睡时间。
  // 一旦用户主动切换过睡眠类型，后续微调时间不再覆盖用户选择。
  function applyDuration(minutes: number) {
    const endISO = combineLocalDateTimeToISO(state.endDate, state.endTime);
    const endDate = endISO ? new Date(endISO) : new Date();
    const startDate = subMinutes(endDate, minutes);
    const startParts = splitLocalDateTime(startDate);
    onChange({
      startDate: startParts.date,
      startTime: startParts.time,
      ...(subtypeLocked ? {} : { subtype: guessSleepSubtype(startDate) }),
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
      ...(subtypeLocked ? {} : { subtype: guessSleepSubtype(startDate) }),
    });
  }

  return (
    <FieldGroup className="gap-4">
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">睡眠类型</p>
        <SegmentedControl
          ariaLabel="睡眠类型"
          options={SLEEP_SUBTYPE_OPTIONS}
          value={state.subtype}
          onChange={onSubtypeSelect}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-foreground">快捷时长</p>
          <button
            type="button"
            onClick={setEndNow}
            className="shrink-0 cursor-pointer text-xs font-medium text-primary hover:underline"
          >
            刚醒（设为现在）
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SLEEP_DURATION_PRESETS.map((preset) => (
            <QuickChip
              key={preset.label}
              tone="sleep"
              active={durationMin === preset.minutes}
              onClick={() => applyDuration(preset.minutes)}
            >
              {preset.label}
            </QuickChip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">入睡时间</p>
        <DateTimeInputRow
          dateValue={state.startDate}
          timeValue={state.startTime}
          maxDate={maxDate}
          dateAriaLabel="入睡日期"
          timeAriaLabel="入睡时间"
          onDateChange={(nextDate) => onChange({ startDate: nextDate })}
          onTimeChange={(nextTime) => {
            const parsed = combineLocalDateTimeToISO(state.startDate, nextTime);
            onChange({
              startTime: nextTime,
              ...(!subtypeLocked && parsed ? { subtype: guessSleepSubtype(new Date(parsed)) } : {}),
            });
          }}
        />
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">醒来时间</p>
        <DateTimeInputRow
          dateValue={state.endDate}
          timeValue={state.endTime}
          maxDate={maxDate}
          dateAriaLabel="醒来日期"
          timeAriaLabel="醒来时间"
          onDateChange={(nextDate) => onChange({ endDate: nextDate })}
          onTimeChange={(nextTime) => onChange({ endTime: nextTime })}
        />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2.5 text-xs">
        <span className="text-muted-foreground">本次时长</span>
        <span className="font-semibold text-foreground tabular-nums">
          {durationMin > 0 ? formatDurationMin(durationMin) : '请调整入睡与醒来时间'}
        </span>
      </div>
    </FieldGroup>
  );
}
