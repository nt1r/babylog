import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO, subMinutes } from 'date-fns';
import { Baby, BellRing, HeartPulse, Milk, MoonStar, Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import { CareFields, type CareFormState } from '@/components/quick-record/care-fields';
import { FeedingFields, type FeedingFormState } from '@/components/quick-record/feeding-fields';
import { HealthFields, type HealthFormState } from '@/components/quick-record/health-fields';
import { SleepFields, type SleepFormState } from '@/components/quick-record/sleep-fields';
import { TimeOffsetPicker } from '@/components/quick-record/time-offset-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import type { RecordCategory } from '@/lib/categories';
import {
  type CareSubtype,
  createCareRecord,
  createFeedingRecord,
  createHealthRecord,
  createSleepRecord,
  type FeedingSubtype,
  type HealthSubtype,
  invalidateAllRecordQueries,
  type SleepSubtype,
  type SmartDefaults,
  updateCareRecord,
  updateFeedingRecord,
  updateHealthRecord,
  updateSleepRecord,
  useSmartDefaultsQuery,
} from '@/lib/records';
import { combineLocalDateTimeToISO, formatDurationMin, guessSleepSubtype, splitLocalDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/stores/preferences';

const CATEGORIES: ReadonlyArray<{
  id: RecordCategory;
  label: string;
  hint: string;
  badgeVariant: 'feeding' | 'sleep' | 'health' | 'care' | 'default';
  icon: typeof Milk;
  activeClass: string;
  spanFull?: boolean;
}> = [
  {
    id: 'feeding',
    label: '喂养',
    hint: '母乳 / 奶粉 / 辅食',
    badgeVariant: 'feeding',
    icon: Milk,
    activeClass: 'border-feeding bg-feeding-soft text-feeding-soft-foreground',
  },
  {
    id: 'sleep',
    label: '睡眠',
    hint: '小睡 / 夜觉补录',
    badgeVariant: 'sleep',
    icon: MoonStar,
    activeClass: 'border-sleep bg-sleep-soft text-sleep-soft-foreground',
  },
  {
    id: 'care',
    label: '护理',
    hint: '排便 / 尿布 / 洗澡',
    badgeVariant: 'care',
    icon: Baby,
    activeClass: 'border-care bg-care-soft text-care-soft-foreground',
  },
  {
    id: 'health',
    label: '健康',
    hint: '体温 / 用药 / 生长',
    badgeVariant: 'health',
    icon: HeartPulse,
    activeClass: 'border-health bg-health-soft text-health-soft-foreground',
  },
  {
    id: 'reminder',
    label: '提醒',
    hint: '第 2 期上线',
    badgeVariant: 'default',
    icon: BellRing,
    activeClass: 'border-primary bg-accent text-accent-foreground',
    spanFull: true,
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
  const isReminder = category === 'reminder';
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

    if (isReminder) {
      toast.info('提醒待办功能将在第 2 期上线', '本期已优先开放喂养、睡眠、护理与健康记录的完整保存与统计。');
      setOpen(false);
      return;
    }

    setFormError('');
    setSubmitting(true);

    try {
      if (category === 'feeding') {
        const recordedAt = combineLocalDateTimeToISO(dateStr, timeStr);
        if (!recordedAt) {
          setFormError('请选择有效的喂养日期与时间');
          return;
        }
        const parsedML = Number.parseInt(feeding.amountMLText, 10);
        const parsedMin = Number.parseInt(feeding.breastMinText, 10);

        if (
          (feeding.subtype === 'formula' || (feeding.subtype === 'breast' && feeding.feedingMode === 'bottle')) &&
          (Number.isNaN(parsedML) || parsedML < 1 || parsedML > 1000)
        ) {
          setFormError('请输入 1 至 1000 ml 之间的有效奶量');
          return;
        }
        if (
          feeding.subtype === 'breast' &&
          feeding.feedingMode === 'direct' &&
          (Number.isNaN(parsedMin) || parsedMin < 1 || parsedMin > 180)
        ) {
          setFormError('请输入 1 至 180 分钟之间的有效亲喂时长');
          return;
        }

        const payload =
          feeding.subtype === 'formula'
            ? { subtype: 'formula' as const, amount_ml: parsedML, recorded_at: recordedAt, note }
            : feeding.subtype === 'breast'
              ? feeding.feedingMode === 'bottle'
                ? {
                    subtype: 'breast' as const,
                    feeding_mode: 'bottle' as const,
                    amount_ml: parsedML,
                    recorded_at: recordedAt,
                    note,
                  }
                : {
                    subtype: 'breast' as const,
                    feeding_mode: 'direct' as const,
                    breast_side: feeding.breastSide,
                    duration_min: parsedMin,
                    recorded_at: recordedAt,
                    note,
                  }
              : {
                  subtype: 'solid' as const,
                  solid_food: feeding.solidFood.trim(),
                  solid_amount: feeding.solidAmount.trim() || null,
                  acceptance: feeding.acceptance || null,
                  recorded_at: recordedAt,
                  note,
                };

        if (isEdit && editing.category === 'feeding') {
          await updateFeedingRecord(editing.record.id, payload);
          toast.success('喂养记录已更新');
        } else {
          await createFeedingRecord(payload);
          toast.success('已记录一笔喂养');
        }
      } else if (category === 'sleep') {
        const startedAt = combineLocalDateTimeToISO(sleep.startDate, sleep.startTime);
        const endedAt = combineLocalDateTimeToISO(sleep.endDate, sleep.endTime);
        if (!startedAt || !endedAt) {
          setFormError('请选择有效的入睡与醒来时间');
          return;
        }
        if (sleepPreviewMin <= 0) {
          setFormError('醒来时间必须晚于入睡时间');
          return;
        }
        const payload = {
          subtype: sleep.subtype,
          started_at: startedAt,
          ended_at: endedAt,
          note,
        };
        if (isEdit && editing.category === 'sleep') {
          await updateSleepRecord(editing.record.id, payload);
          toast.success('睡眠记录已更新');
        } else {
          await createSleepRecord(payload);
          toast.success('已记录一笔睡眠', formatDurationMin(sleepPreviewMin));
        }
      } else if (category === 'care') {
        const recordedAt = combineLocalDateTimeToISO(dateStr, timeStr);
        if (!recordedAt) {
          setFormError('请选择有效的护理日期与时间');
          return;
        }
        const payload =
          care.subtype === 'diaper'
            ? {
                subtype: 'diaper' as const,
                diaper_kind: care.diaperKind,
                stool_consistency: care.diaperKind === 'pee' ? null : care.stoolConsistency || null,
                stool_color: care.diaperKind === 'pee' ? null : care.stoolColor || null,
                recorded_at: recordedAt,
                note,
              }
            : care.subtype === 'bath'
              ? { subtype: 'bath' as const, recorded_at: recordedAt, note }
              : { subtype: 'other' as const, care_title: care.careTitle.trim(), recorded_at: recordedAt, note };

        if (isEdit && editing.category === 'care') {
          await updateCareRecord(editing.record.id, payload);
          toast.success('护理记录已更新');
        } else {
          await createCareRecord(payload);
          toast.success('已记录一笔护理');
        }
      } else if (category === 'health') {
        const recordedAt = combineLocalDateTimeToISO(dateStr, timeStr);
        if (!recordedAt) {
          setFormError('请选择有效的记录日期与时间');
          return;
        }
        const parsedTemp = Number.parseFloat(health.temperatureText);
        if (health.subtype === 'temperature' && (Number.isNaN(parsedTemp) || parsedTemp < 34 || parsedTemp > 43)) {
          setFormError('请输入 34.0 至 43.0 ℃ 之间的有效体温');
          return;
        }
        const parsedWeight = health.weightKg.trim() ? Number.parseFloat(health.weightKg) : null;
        const parsedHeight = health.heightCm.trim() ? Number.parseFloat(health.heightCm) : null;
        const parsedHead = health.headCm.trim() ? Number.parseFloat(health.headCm) : null;

        const payload =
          health.subtype === 'temperature'
            ? { subtype: 'temperature' as const, temperature_c: parsedTemp, recorded_at: recordedAt, note }
            : health.subtype === 'medicine'
              ? {
                  subtype: 'medicine' as const,
                  medicine_name: health.medicineName.trim(),
                  medicine_dosage: health.medicineDosage.trim() || null,
                  recorded_at: recordedAt,
                  note,
                }
              : health.subtype === 'growth'
                ? {
                    subtype: 'growth' as const,
                    weight_kg: parsedWeight !== null && !Number.isNaN(parsedWeight) ? parsedWeight : null,
                    height_cm: parsedHeight !== null && !Number.isNaN(parsedHeight) ? parsedHeight : null,
                    head_cm: parsedHead !== null && !Number.isNaN(parsedHead) ? parsedHead : null,
                    recorded_at: recordedAt,
                    note,
                  }
                : { subtype: 'teeth' as const, tooth_note: health.toothNote.trim(), recorded_at: recordedAt, note };

        if (isEdit && editing.category === 'health') {
          await updateHealthRecord(editing.record.id, payload);
          toast.success('健康记录已更新');
        } else {
          await createHealthRecord(payload);
          toast.success('已记录一笔健康数据');
        }
      }

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
      : isReminder
        ? '新建提醒'
        : '快速记一笔';

  return (
    <EntityDrawer
      open={open}
      onOpenChange={setOpen}
      title={drawerTitle}
      description={isEdit ? '修改后将自动重新计算当日统计与趋势' : '已自动带出当前时间与惯用值，少一步输入'}
      icon={isReminder ? <BellRing className="size-4.5" /> : <Sparkles className="size-4.5" />}
      badge={<Badge variant={activeCategory.badgeVariant}>{activeCategory.label}</Badge>}
      footer={
        <>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit" form="quick-record-form" disabled={submitting}>
            {submitting ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
            {submitting ? '保存中…' : isEdit ? '保存修改' : isReminder ? '知道了' : '保存记录'}
          </Button>
        </>
      }
    >
      <form id="quick-record-form" onSubmit={handleSubmit} noValidate className="space-y-5">
        {!isEdit ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">分类</p>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.filter((c) => c.id !== 'reminder' || isReminder).map((item) => {
                const Icon = item.icon;
                const selected = item.id === category;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      markTouched();
                      setCategory(item.id);
                    }}
                    className={cn(
                      'flex min-h-13 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      item.spanFull && 'col-span-2',
                      selected ? item.activeClass : 'border-border/80 bg-card text-foreground hover:bg-muted/60',
                    )}
                  >
                    <Icon className="size-4.5 shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="block truncate text-xs opacity-80">{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {isReminder ? (
          <div className="rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
            提醒待办（疫苗接种、儿保体检、定时用药重复提醒）将在第 2 期上线，届时可一键完成并自动生成对应健康记录。
          </div>
        ) : null}

        {/* 睡眠使用独立的起止时间区间选择器，其余三类共用单个记录时间 + 相对偏移胶囊。 */}
        {!isReminder && category !== 'sleep' ? (
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

        {!isReminder ? (
          <Field invalid={Boolean(formError)}>
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
            <FieldError>{formError}</FieldError>
          </Field>
        ) : null}
      </form>
    </EntityDrawer>
  );
}
