import { differenceInCalendarDays, subDays } from 'date-fns';
import { AlertCircle, FileSpreadsheet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityDrawer } from '@/components/entity-drawer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { QuickChip } from '@/components/ui/choice-controls';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useActiveBaby } from '@/lib/baby';
import {
  ALL_EXPORT_CATEGORIES,
  downloadExportXlsx,
  EXPORT_CATEGORY_OPTIONS,
  type ExportCategoryKey,
  type ExportRangePreset,
  MAX_EXPORT_SPAN_DAYS,
  validateExportSelection,
} from '@/lib/export';
import { formatLocalDateKey, parseLocalDateKey } from '@/lib/time';
import { useExportDrawerStore } from '@/stores/export-drawer';

const PRESET_OPTIONS: ReadonlyArray<{ readonly value: ExportRangePreset; readonly label: string }> = [
  { value: '7', label: '近 7 天' },
  { value: '14', label: '近 14 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: 'custom', label: '自定义日期' },
];

/**
 * 数据导出抽屉：支持预设时间范围与自定义起止日期（最长 366 天）及多分类筛选，
 * 导出包含「按日汇总」与各分类明细的多表 Excel 表格。
 */
export function ExportExcelDrawer() {
  const open = useExportDrawerStore((s) => s.open);
  const initialPreset = useExportDrawerStore((s) => s.initialPreset);
  const close = useExportDrawerStore((s) => s.close);
  const { activeBaby } = useActiveBaby();
  const activeBabyId = activeBaby?.id ?? null;

  const [todayStr, setTodayStr] = useState(() => formatLocalDateKey(new Date()));
  const [preset, setPreset] = useState<ExportRangePreset>(initialPreset);
  const [startDate, setStartDate] = useState(() => formatLocalDateKey(subDays(new Date(), 29)));
  const [endDate, setEndDate] = useState(() => formatLocalDateKey(new Date()));
  const [categories, setCategories] = useState<ExportCategoryKey[]>([...ALL_EXPORT_CATEGORIES]);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const prevBabyIdRef = useRef(activeBabyId);

  // 每次打开抽屉时按当前本地日期刷新默认起止日期、恢复全选并同步默认预设，避免跨零点或换娃残留旧筛选。
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const today = formatLocalDateKey(now);
    setTodayStr(today);
    setPreset(initialPreset);
    setStartDate(formatLocalDateKey(subDays(now, 29)));
    setEndDate(today);
    setCategories([...ALL_EXPORT_CATEGORIES]);
    setSubmitError(null);
  }, [open, initialPreset]);

  // 切换宝宝时自动关闭抽屉，防止跨宝宝误导。
  useEffect(() => {
    if (prevBabyIdRef.current !== activeBabyId) {
      prevBabyIdRef.current = activeBabyId;
      if (open && !submittingRef.current) {
        close();
      }
    }
  }, [activeBabyId, open, close]);

  const validationError = useMemo(
    () => validateExportSelection({ preset, startDate, endDate, categories }),
    [preset, startDate, endDate, categories],
  );

  const customSpanDays = useMemo(() => {
    if (preset !== 'custom') return null;
    const s = parseLocalDateKey(startDate);
    const e = parseLocalDateKey(endDate);
    if (!s || !e || e < s) return null;
    return differenceInCalendarDays(e, s) + 1;
  }, [preset, startDate, endDate]);

  const allSelected = categories.length === ALL_EXPORT_CATEGORIES.length;

  function toggleCategory(key: ExportCategoryKey) {
    setSubmitError(null);
    setCategories((prev) => {
      if (prev.includes(key)) {
        return prev.filter((item) => item !== key);
      }
      return ALL_EXPORT_CATEGORIES.filter((item) => item === key || prev.includes(item));
    });
  }

  function handleToggleAll() {
    setSubmitError(null);
    setCategories(allSelected ? [] : [...ALL_EXPORT_CATEGORIES]);
  }

  async function handleExport() {
    if (submittingRef.current || activeBabyId === null) return;
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setSubmitError(null);
    try {
      await downloadExportXlsx(activeBabyId, {
        preset,
        startDate,
        endDate,
        categories,
      });
      toast.success('表格已开始下载');
      close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导出失败，请稍后重试';
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  const displayError = submitError ?? validationError;

  return (
    <EntityDrawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      pending={pending}
      title="导出照护数据表格"
      description={
        activeBaby
          ? `为 ${activeBaby.nickname} 生成包含「按日汇总」与各分类明细的 Excel 表格，方便留存或就医参考。`
          : '生成包含「按日汇总」与各分类明细的 Excel 表格。'
      }
      icon={<FileSpreadsheet className="size-4.5" strokeWidth={1.8} />}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>
            取消
          </Button>
          <Button
            type="button"
            disabled={pending || Boolean(validationError) || activeBabyId === null}
            onClick={() => void handleExport()}
          >
            {pending ? (
              <>
                <Spinner className="size-4" aria-hidden="true" role="presentation" />
                正在生成…
              </>
            ) : (
              <>
                <FileSpreadsheet className="size-4" />
                导出表格
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field>
          <FieldLabel>时间范围</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {PRESET_OPTIONS.map((opt) => (
              <QuickChip
                key={opt.value}
                active={preset === opt.value}
                disabled={pending}
                onClick={() => {
                  setSubmitError(null);
                  setPreset(opt.value);
                }}
              >
                {opt.label}
              </QuickChip>
            ))}
          </div>
        </Field>

        {preset === 'custom' ? (
          <div className="space-y-2.5 rounded-xl border border-border/80 bg-muted/25 p-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="export-start-date">开始日期</FieldLabel>
                <DatePicker
                  id="export-start-date"
                  value={startDate}
                  onChange={(next) => {
                    setSubmitError(null);
                    setStartDate(next);
                  }}
                  max={todayStr}
                  disabled={pending}
                  ariaLabel="选择导出开始日期"
                  drawerTitle="选择开始日期"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="export-end-date">结束日期</FieldLabel>
                <DatePicker
                  id="export-end-date"
                  value={endDate}
                  onChange={(next) => {
                    setSubmitError(null);
                    setEndDate(next);
                  }}
                  min={startDate || undefined}
                  max={todayStr}
                  disabled={pending}
                  ariaLabel="选择导出结束日期"
                  drawerTitle="选择结束日期"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {customSpanDays !== null
                ? `已选共 ${customSpanDays} 天（单次最长支持 ${MAX_EXPORT_SPAN_DAYS} 天）`
                : `单次自定义导出最长支持 ${MAX_EXPORT_SPAN_DAYS} 天`}
            </p>
          </div>
        ) : null}

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>导出内容（按勾选生成对应工作表）</FieldLabel>
            <button
              type="button"
              disabled={pending}
              onClick={handleToggleAll}
              className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allSelected ? '取消全选' : '全部勾选'}
            </button>
          </div>

          <div className="grid gap-2">
            {EXPORT_CATEGORY_OPTIONS.map((item) => {
              const checked = categories.includes(item.key);
              const checkboxId = `export-cat-${item.key}`;
              return (
                <label
                  key={item.key}
                  htmlFor={checkboxId}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card px-3.5 py-2.5 transition-colors hover:border-primary/40"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    disabled={pending}
                    onCheckedChange={() => toggleCategory(item.key)}
                    className="mt-0.5"
                    aria-label={item.label}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <p className="rounded-xl bg-muted/45 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
          首页将自动附带「按日汇总」总表，便于快速总览每日奶量、睡眠与排泄变化；后续工作表按时间顺序列出所选分类的完整明细。
        </p>

        {displayError ? (
          <Alert variant="destructive" size="compact">
            <AlertCircle className="size-4" />
            <AlertDescription>{displayError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </EntityDrawer>
  );
}
