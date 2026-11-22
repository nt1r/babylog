import { format } from 'date-fns';
import { Baby, BellRing, HeartPulse, Milk, MoonStar, Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import type { RecordCategory } from '@/lib/categories';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/stores/preferences';

const CATEGORIES: ReadonlyArray<{
  id: RecordCategory;
  label: string;
  hint: string;
  timeLabel: string;
  unitLabel: string;
  placeholder: string;
  presets: readonly string[];
  badgeVariant: 'feeding' | 'sleep' | 'health' | 'care' | 'default';
  icon: typeof Milk;
  activeClass: string;
  spanFull?: boolean;
}> = [
  {
    id: 'feeding',
    label: '喂养',
    hint: '母乳 / 奶粉 / 辅食',
    timeLabel: '时间',
    unitLabel: '奶量或时长',
    placeholder: '例如：120 ml 配方奶',
    presets: ['60 ml 配方奶', '90 ml 配方奶', '120 ml 配方奶', '亲喂 15 分钟', '辅食一餐'],
    badgeVariant: 'feeding',
    icon: Milk,
    activeClass: 'border-feeding bg-feeding-soft text-feeding-soft-foreground',
  },
  {
    id: 'sleep',
    label: '睡眠',
    hint: '小睡 / 夜觉',
    timeLabel: '时间',
    unitLabel: '睡眠时长',
    placeholder: '例如：小睡 45 分钟',
    presets: ['小睡 30 分钟', '小睡 1 小时', '小睡 1.5 小时', '入睡打卡'],
    badgeVariant: 'sleep',
    icon: MoonStar,
    activeClass: 'border-sleep bg-sleep-soft text-sleep-soft-foreground',
  },
  {
    id: 'care',
    label: '护理',
    hint: '排便 / 尿布 / 洗澡',
    timeLabel: '时间',
    unitLabel: '护理内容',
    placeholder: '例如：换纸尿裤 · 便便正常',
    presets: ['嘘嘘', '便便正常', '洗澡', '剪指甲'],
    badgeVariant: 'care',
    icon: Baby,
    activeClass: 'border-care bg-care-soft text-care-soft-foreground',
  },
  {
    id: 'health',
    label: '健康',
    hint: '体温 / 用药 / 生长',
    timeLabel: '时间',
    unitLabel: '体温或情况',
    placeholder: '例如：耳温 36.7 ℃',
    presets: ['36.5 ℃ 正常', '36.8 ℃ 正常', '37.3 ℃ 留意', '维生素 D3'],
    badgeVariant: 'health',
    icon: HeartPulse,
    activeClass: 'border-health bg-health-soft text-health-soft-foreground',
  },
  {
    id: 'reminder',
    label: '提醒',
    hint: '疫苗接种 / 儿保体检 / 定时用药',
    timeLabel: '提醒时间',
    unitLabel: '提醒事项',
    placeholder: '例如：上午 9:30 社区医院接种疫苗',
    presets: ['接种疫苗', '儿保体检', '每日维生素 D3', '定时喂药'],
    badgeVariant: 'default',
    icon: BellRing,
    activeClass: 'border-primary bg-accent text-accent-foreground',
    spanFull: true,
  },
];

export function QuickRecordDrawer() {
  const open = usePreferencesStore((state) => state.quickRecordOpen);
  const initialCategory = usePreferencesStore((state) => state.quickRecordCategory);
  const setOpen = usePreferencesStore((state) => state.setQuickRecordOpen);

  const [category, setCategory] = useState<RecordCategory>(initialCategory);
  const [time, setTime] = useState(() => format(new Date(), 'HH:mm'));
  const [detail, setDetail] = useState('');
  const [note, setNote] = useState('');
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    if (open) {
      setCategory(initialCategory);
      setTime(format(new Date(), 'HH:mm'));
      setDetail('');
      setNote('');
      setDetailError('');
    }
  }, [open, initialCategory]);

  const activeCategory = CATEGORIES.find((item) => item.id === category) ?? CATEGORIES[0];
  const isReminder = category === 'reminder';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDetail = detail.trim();
    if (!trimmedDetail) {
      setDetailError(isReminder ? '请填写或点选一项提醒事项' : '请填写或点选一项记录内容');
      return;
    }

    toast.info(
      isReminder ? '提醒保存功能即将上线' : '记录保存功能即将上线',
      `「${activeCategory.label} · ${trimmedDetail}」暂未写入历史，敬请期待。`,
    );
    setDetail('');
    setNote('');
    setDetailError('');
    setOpen(false);
  }

  return (
    <EntityDrawer
      open={open}
      onOpenChange={setOpen}
      title={isReminder ? '新建提醒' : '快速记一笔'}
      description={isReminder ? '点选常用事项或自定义输入提醒内容' : '点选常用项即可快速完成记录'}
      icon={isReminder ? <BellRing className="size-4.5" /> : <Sparkles className="size-4.5" />}
      badge={<Badge variant={activeCategory.badgeVariant}>{activeCategory.label}</Badge>}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit" form="quick-record-form">
            {isReminder ? '保存提醒' : '保存记录'}
          </Button>
        </>
      }
    >
      <form id="quick-record-form" onSubmit={handleSubmit} noValidate className="space-y-5">
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-foreground">分类</p>
          <div className="grid grid-cols-2 gap-2.5">
            {CATEGORIES.map((item) => {
              const Icon = item.icon;
              const selected = item.id === category;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setCategory(item.id);
                    setDetail('');
                    setDetailError('');
                  }}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="quick-record-time">{activeCategory.timeLabel}</FieldLabel>
            <Input
              id="quick-record-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="tabular-nums"
              required
            />
          </Field>

          <Field invalid={Boolean(detailError)}>
            <FieldLabel htmlFor="quick-record-detail">{activeCategory.unitLabel}</FieldLabel>
            <Input
              id="quick-record-detail"
              value={detail}
              aria-invalid={Boolean(detailError)}
              onChange={(event) => {
                setDetail(event.target.value);
                if (detailError) setDetailError('');
              }}
              placeholder={activeCategory.placeholder}
            />
            <FieldError>{detailError}</FieldError>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {activeCategory.presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setDetail(preset);
                    if (detailError) setDetailError('');
                  }}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    detail === preset
                      ? activeCategory.activeClass
                      : 'border-border/80 bg-muted/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="quick-record-note">备注（可选）</FieldLabel>
            <Input
              id="quick-record-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={isReminder ? '补充医院、剂量或注意事项…' : '记录宝宝的精神状态或小变化…'}
            />
          </Field>
        </FieldGroup>
      </form>
    </EntityDrawer>
  );
}
