import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO, subMinutes } from 'date-fns';
import { AlertCircle, Baby, HeartPulse, Milk, MoonStar, Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import { CareFields, type CareFormState } from '@/components/quick-record/care-fields';
import { FeedingFields, type FeedingFormState } from '@/components/quick-record/feeding-fields';
import { HealthFields, type HealthFormState } from '@/components/quick-record/health-fields';
import { SleepFields, type SleepFormState } from '@/components/quick-record/sleep-fields';
import { submitQuickRecord } from '@/components/quick-record/submit';
import { TimeOffsetPicker } from '@/components/quick-record/time-offset-picker';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import type { RecordCategory } from '@/lib/categories';
import {
  type CareSubtype,
  type FeedingSubtype,
  type HealthSubtype,
  invalidateAllRecordQueries,
  type SleepSubtype,
  type SmartDefaults,
  useSmartDefaultsQuery,
} from '@/lib/records';
import { combineLocalDateTimeToISO, guessSleepSubtype, splitLocalDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/stores/preferences';

const CATEGORIES: ReadonlyArray<{
  id: RecordCategory;
  label: string;
  icon: typeof Milk;
  activeClass: string;
}> = [
  {
    id: 'feeding',
    label: '喂养',
    icon: Milk,
    activeClass: 'border-feeding bg-feeding-soft text-feeding-soft-foreground',
  },
  {
    id: 'sleep',
    label: '睡眠',
    icon: MoonStar,
    activeClass: 'border-sleep bg-sleep-soft text-sleep-soft-foreground',
  },
  {
    id: 'care',
    label: '护理',
    icon: Baby,
    activeClass: 'border-care bg-care-soft text-care-soft-foreground',
  },
  {
    id: 'health',
    label: '健康',
    icon: HeartPulse,
    activeClass: 'border-health bg-health-soft text-health-soft-foreground',
  },
];

const SOLID_FOOD_FALLBACKS = ['高铁米粉', '南瓜泥', '苹果泥', '蛋黄', '蔬菜粥'] as const;
const CARE_OTHER_FALLBACKS = ['剪指甲', '抚触按摩', '洗鼻子', '涂润肤露'] as const;

function buildDefaultFeeding(
  initialCategory: RecordCategory,
  initialSubtype: string | null,
  defaults?: SmartDefaults,
): FeedingFormState {
  const sub: FeedingSubtype =
    initialCategory === 'feeding' &&
    (initialSubtype === 'breast' || initialSubtype === 'formula' || initialSubtype === 'solid')
      ? initialSubtype
      : (defaults?.feeding.last_feeding_subtype ?? 'formula');
  return {
    subtype: sub,
    feedingMode: 'direct',
    breastSide: defaults?.feeding.suggested_breast_side ?? 'left',
    amountMLText: String(defaults?.feeding.last_milk_ml ?? 90),
    breastMinText: '15',
    solidFood: '',
    solidAmount: '',
    acceptance: '',
  };
}

function buildDefaultSleep(now: Date, initialCategory: RecordCategory, initialSubtype: string | null): SleepFormState {
  const sub: SleepSubtype =
    initialCategory === 'sleep' && (initialSubtype === 'nap' || initialSubtype === 'night')
      ? initialSubtype
      : guessSleepSubtype(now);
  const startParts = splitLocalDateTime(subMinutes(now, sub === 'night' ? 480 : 60));
  const endParts = splitLocalDateTime(now);
  return {
    subtype: sub,
    startDate: startParts.date,
    startTime: startParts.time,
    endDate: endParts.date,
    endTime: endParts.time,
  };
}

function buildDefaultCare(initialCategory: RecordCategory, initialSubtype: string | null): CareFormState {
  const sub: CareSubtype =
    initialCategory === 'care' &&
    (initialSubtype === 'diaper' || initialSubtype === 'bath' || initialSubtype === 'other')
      ? initialSubtype
      : 'diaper';
  return {
    subtype: sub,
    diaperKind: 'pee',
    stoolConsistency: '',
    stoolColor: '',
    careTitle: '',
  };
}

function buildDefaultHealth(
  initialCategory: RecordCategory,
  initialSubtype: string | null,
  defaults?: SmartDefaults,
): HealthFormState {
  const sub: HealthSubtype =
    initialCategory === 'health' &&
    (initialSubtype === 'temperature' ||
      initialSubtype === 'medicine' ||
      initialSubtype === 'growth' ||
      initialSubtype === 'teeth')
      ? initialSubtype
      : 'temperature';
  return {
    subtype: sub,
    temperatureText: (defaults?.health.last_temperature_c ?? 36.6).toFixed(1),
    medicineName: '',
    medicineDosage: '',
    weightKg: '',
    heightCm: '',
    headCm: '',
    toothNote: '',
  };
}

export function QuickRecordDrawer() {
  const queryClient = useQueryClient();
  const open = usePreferencesStore((state) => state.quickRecordOpen);
  const initialCategory = usePreferencesStore((state) => state.quickRecordCategory);
  const mode = usePreferencesStore((state) => state.quickRecordMode);
  const editing = usePreferencesStore((state) => state.quickRecordEditing);
  const initialSubtype = usePreferencesStore((state) => state.quickRecordInitialSubtype);
  const setOpen = usePreferencesStore((state) => state.setQuickRecordOpen);

  const defaultsQuery = useSmartDefaultsQuery(open);
  const defaults = defaultsQuery.data;
  const isEdit = mode === 'edit' && editing !== null;

  const [category, setCategory] = useState<RecordCategory>(initialCategory);
  const [dateStr, setDateStr] = useState(() => splitLocalDateTime(new Date()).date);
  const [timeStr, setTimeStr] = useState(() => splitLocalDateTime(new Date()).time);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sleepSubtypeLocked, setSleepSubtypeLocked] = useState(false);

  const [feeding, setFeeding] = useState<FeedingFormState>(() => buildDefaultFeeding('feeding', null));
  const [sleep, setSleep] = useState<SleepFormState>(() => buildDefaultSleep(new Date(), 'sleep', null));
  const [care, setCare] = useState<CareFormState>(() => buildDefaultCare('care', null));
  const [health, setHealth] = useState<HealthFormState>(() => buildDefaultHealth('health', null));

  // 用 ref 追踪本次抽屉打开生命周期内的用户编辑状态与默认值回填状态，
  // 防止异步到达的 defaults 或窗口焦点刷新冲掉用户已经修改的表单内容。
  const userTouchedRef = useRef(false);
  const defaultsAppliedRef = useRef(false);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  useEffect(() => {
    if (!open) {
      userTouchedRef.current = false;
      defaultsAppliedRef.current = false;
      return;
    }

    const now = new Date();
    const nowParts = splitLocalDateTime(now);
    const currentDefaults = defaultsRef.current;

    userTouchedRef.current = false;
    defaultsAppliedRef.current = Boolean(currentDefaults);
    setFormError('');
    setSubmitting(false);

    if (editing && (mode === 'edit' || mode === 'duplicate')) {
      setCategory(editing.category);
      setSleepSubtypeLocked(true);
      const useOriginalTime = mode === 'edit';

      if (editing.category === 'feeding') {
        const r = editing.record;
        const dt = useOriginalTime ? splitLocalDateTime(parseISO(r.recorded_at)) : nowParts;
        setDateStr(dt.date);
        setTimeStr(dt.time);
        setNote(r.note);
        setFeeding({
          subtype: r.subtype,
          feedingMode: r.feeding_mode ?? 'direct',
          breastSide: r.breast_side ?? currentDefaults?.feeding.suggested_breast_side ?? 'left',
          amountMLText: String(r.amount_ml ?? currentDefaults?.feeding.last_milk_ml ?? 90),
          breastMinText: String(r.duration_min ?? 15),
          solidFood: r.solid_food ?? '',
          solidAmount: r.solid_amount ?? '',
          acceptance: r.acceptance ?? '',
        });
        return;
      }

      if (editing.category === 'sleep') {
        const r = editing.record;
        setNote(r.note);
        if (useOriginalTime) {
          const st = splitLocalDateTime(parseISO(r.started_at));
          const et = splitLocalDateTime(parseISO(r.ended_at));
          setSleep({
            subtype: r.subtype,
            startDate: st.date,
            startTime: st.time,
            endDate: et.date,
            endTime: et.time,
          });
        } else {
          const st = splitLocalDateTime(subMinutes(now, r.duration_min));
          setSleep({
            subtype: r.subtype,
            startDate: st.date,
            startTime: st.time,
            endDate: nowParts.date,
            endTime: nowParts.time,
          });
        }
        return;
      }

      if (editing.category === 'care') {
        const r = editing.record;
        const dt = useOriginalTime ? splitLocalDateTime(parseISO(r.recorded_at)) : nowParts;
        setDateStr(dt.date);
        setTimeStr(dt.time);
        setNote(r.note);
        setCare({
          subtype: r.subtype,
          diaperKind: r.diaper_kind ?? 'pee',
          stoolConsistency: r.stool_consistency ?? '',
          stoolColor: r.stool_color ?? '',
          careTitle: r.care_title ?? '',
        });
        return;
      }

      if (editing.category === 'health') {
        const r = editing.record;
        const dt = useOriginalTime ? splitLocalDateTime(parseISO(r.recorded_at)) : nowParts;
        setDateStr(dt.date);
        setTimeStr(dt.time);
        setNote(r.note);
        setHealth({
          subtype: r.subtype,
          temperatureText: (r.temperature_c ?? currentDefaults?.health.last_temperature_c ?? 36.6).toFixed(1),
          medicineName: r.medicine_name ?? '',
          medicineDosage: r.medicine_dosage ?? '',
          weightKg: r.weight_kg !== null ? String(r.weight_kg) : '',
          heightCm: r.height_cm !== null ? String(r.height_cm) : '',
          headCm: r.head_cm !== null ? String(r.head_cm) : '',
          toothNote: r.tooth_note ?? '',
        });
        return;
      }
    }

    setCategory(initialCategory);
    setSleepSubtypeLocked(initialCategory === 'sleep' && (initialSubtype === 'nap' || initialSubtype === 'night'));
    setDateStr(nowParts.date);
    setTimeStr(nowParts.time);
    setNote('');
    setFeeding(buildDefaultFeeding(initialCategory, initialSubtype, currentDefaults));
    setSleep(buildDefaultSleep(now, initialCategory, initialSubtype));
    setCare(buildDefaultCare(initialCategory, initialSubtype));
    setHealth(buildDefaultHealth(initialCategory, initialSubtype, currentDefaults));
  }, [open, initialCategory, mode, editing, initialSubtype]);

  // 仅在新建模式且用户尚未手动输入过时，用首次异步返回的智能默认值补齐预填项。
  useEffect(() => {
    if (!open || mode !== 'create' || !defaults || defaultsAppliedRef.current || userTouchedRef.current) {
      return;
    }
    defaultsAppliedRef.current = true;
    setFeeding(buildDefaultFeeding(initialCategory, initialSubtype, defaults));
    setHealth(buildDefaultHealth(initialCategory, initialSubtype, defaults));
  }, [open, mode, defaults, initialCategory, initialSubtype]);

  function markTouched() {
    userTouchedRef.current = true;
    if (formError) setFormError('');
  }

  const activeCategory = CATEGORIES.find((item) => item.id === category) ?? CATEGORIES[0];
  const todayMaxDate = format(new Date(), 'yyyy-MM-dd');

  const sleepPreviewMin = (() => {
    const st = combineLocalDateTimeToISO(sleep.startDate, sleep.startTime);
    const et = combineLocalDateTimeToISO(sleep.endDate, sleep.endTime);
    if (!st || !et) return 0;
    return Math.round((new Date(et).getTime() - new Date(st).getTime()) / 60000);
  })();

  const frequentMilk = defaults?.feeding.frequent_milk_ml ?? [60, 90, 120];
  const solidPresets =
    defaults && defaults.feeding.recent_solid_foods.length > 0
      ? defaults.feeding.recent_solid_foods
      : [...SOLID_FOOD_FALLBACKS];
  const medicinePresets =
    defaults && defaults.health.recent_medicines.length > 0
      ? defaults.health.recent_medicines
      : [
          { name: '维生素 D3', dosage: '1 粒' },
          { name: '维生素 AD', dosage: '1 粒' },
        ];
  const careOtherPresets =
    defaults && defaults.care.recent_other_titles.length > 0
      ? Array.from(new Set([...defaults.care.recent_other_titles, ...CARE_OTHER_FALLBACKS])).slice(0, 6)
      : [...CARE_OTHER_FALLBACKS];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError('');
    setSubmitting(true);
    try {
      const result = await submitQuickRecord({
        category,
        isEdit,
        editing,
        dateStr,
        timeStr,
        note,
        feeding,
        sleep,
        sleepPreviewMin,
        care,
        health,
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toast.success(result.toastTitle, result.toastDescription);
      invalidateAllRecordQueries(queryClient);
      setOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  const drawerTitle = isEdit
    ? `编辑${activeCategory.label}记录`
    : mode === 'duplicate'
      ? `再记一笔${activeCategory.label}`
      : '快速记一笔';

  return (
    <EntityDrawer
      open={open}
      onOpenChange={setOpen}
      title={drawerTitle}
      icon={<Sparkles className="size-4.5" />}
      footer={
        <div className="flex w-full flex-col gap-2.5">
          {formError ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive-soft px-3 py-2 text-xs font-medium text-destructive-soft-foreground"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          ) : null}
          <div className="grid w-full grid-cols-[1fr_2fr] gap-2.5 sm:flex sm:w-auto sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              className="h-11 rounded-xl sm:h-10 sm:px-4"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="quick-record-form"
              disabled={submitting}
              className="h-11 rounded-xl sm:h-10 sm:px-5"
            >
              {submitting ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
              {submitting ? '保存中…' : isEdit ? '保存修改' : '保存记录'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="quick-record-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {!isEdit ? (
          <fieldset aria-label="记录分类" className="grid min-w-0 grid-cols-4 gap-1 border-0 p-0 sm:gap-1.5">
            {CATEGORIES.map((item) => {
              const Icon = item.icon;
              const selected = item.id === category;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    markTouched();
                    setCategory(item.id);
                  }}
                  className={cn(
                    'flex h-10 cursor-pointer items-center justify-center gap-1 rounded-xl border px-1.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-1.5 sm:px-2',
                    selected
                      ? item.activeClass
                      : 'border-border/75 bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </fieldset>
        ) : null}

        {category === 'feeding' ? (
          <FeedingFields
            state={feeding}
            frequentMilk={frequentMilk}
            solidPresets={solidPresets}
            lastBreastSide={defaults?.feeding.last_breast_side ?? null}
            suggestedBreastSide={defaults?.feeding.suggested_breast_side ?? 'left'}
            onChange={(patch) => {
              markTouched();
              setFeeding((prev) => ({ ...prev, ...patch }));
            }}
          />
        ) : null}

        {category === 'sleep' ? (
          <SleepFields
            state={sleep}
            maxDate={todayMaxDate}
            durationMin={sleepPreviewMin}
            subtypeLocked={sleepSubtypeLocked}
            onSubtypeSelect={(subtype) => {
              markTouched();
              setSleepSubtypeLocked(true);
              setSleep((prev) => ({ ...prev, subtype }));
            }}
            onChange={(patch) => {
              markTouched();
              setSleep((prev) => ({ ...prev, ...patch }));
            }}
          />
        ) : null}

        {category === 'care' ? (
          <CareFields
            state={care}
            otherPresets={careOtherPresets}
            onChange={(patch) => {
              markTouched();
              setCare((prev) => ({ ...prev, ...patch }));
            }}
          />
        ) : null}

        {category === 'health' ? (
          <HealthFields
            state={health}
            medicinePresets={medicinePresets}
            onChange={(patch) => {
              markTouched();
              setHealth((prev) => ({ ...prev, ...patch }));
            }}
          />
        ) : null}

        {/* 核心业务字段优先展示在首屏；睡眠自带起止时间区间，其余三类在下方统一提供记录时间与快捷偏移。 */}
        {category !== 'sleep' ? (
          <TimeOffsetPicker
            dateStr={dateStr}
            timeStr={timeStr}
            maxDate={todayMaxDate}
            onChange={(nextDate, nextTime) => {
              markTouched();
              setDateStr(nextDate);
              setTimeStr(nextTime);
            }}
          />
        ) : null}

        <Field>
          <FieldLabel htmlFor="quick-record-note">备注（可选）</FieldLabel>
          <Input
            id="quick-record-note"
            value={note}
            maxLength={500}
            onChange={(event) => {
              markTouched();
              setNote(event.target.value);
            }}
            placeholder="记录宝宝的精神状态、吐奶情况或小变化…"
          />
        </Field>
      </form>
    </EntityDrawer>
  );
}
