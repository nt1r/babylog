import { createFileRoute } from '@tanstack/react-router';
import { Pill, Zap } from 'lucide-react';
import { useRef, useState } from 'react';
import { RecordListPage, type RecordRowDescriptor } from '@/components/record-list-page';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { CLINICAL_HEALTH_SUBTYPE_OPTIONS, HEALTH_SUBTYPE_LABELS, RECORD_CATEGORY_META } from '@/lib/categories';
import {
  getTemperatureSeverity,
  type HealthDailySummary,
  type HealthRecord,
  type MedicinePreset,
  useDeleteRecordMutation,
  useSaveRecordMutation,
  useSmartDefaultsQuery,
} from '@/lib/records';
import { formatLocalDateTimeShort, formatLocalTimeFromISO, getLocalDateKeyFromISO } from '@/lib/time';

export const Route = createFileRoute('/_app/health')({
  component: HealthPage,
});

const META = RECORD_CATEGORY_META.health;
const SUBTYPE_TABS = [{ value: 'all', label: '全部' }, ...CLINICAL_HEALTH_SUBTYPE_OPTIONS] as const;

function formatHealthSummary(sum?: HealthDailySummary): string {
  if (!sum) return '';
  const parts: string[] = [];
  if (sum.latest_temp_c !== null) parts.push(`最近体温 ${sum.latest_temp_c.toFixed(1)} ℃`);
  if (sum.medicine_count > 0) parts.push(`${HEALTH_SUBTYPE_LABELS.medicine} ${sum.medicine_count} 次`);
  parts.push(`共 ${sum.total_count} 次`);
  return parts.join(' · ');
}

function describeHealth(rec: HealthRecord): RecordRowDescriptor {
  const timeLabel = formatLocalTimeFromISO(rec.recorded_at);
  if (rec.subtype === 'temperature' && rec.temperature_c !== null) {
    const severity = getTemperatureSeverity(rec.temperature_c);
    return {
      timeLabel,
      badge: severity.level === 'normal' ? HEALTH_SUBTYPE_LABELS.temperature : severity.label,
      badgeVariant: severity.level === 'normal' ? 'health' : severity.level,
      title: `${rec.temperature_c.toFixed(1)} ℃`,
    };
  }
  return {
    timeLabel,
    badge: HEALTH_SUBTYPE_LABELS.medicine,
    badgeVariant: 'health',
    title: rec.medicine_name ?? '用药记录',
    subtitle: rec.medicine_dosage ? `剂量：${rec.medicine_dosage}` : undefined,
  };
}

function HealthPage() {
  const defaultsQuery = useSmartDefaultsQuery();
  const saveMutation = useSaveRecordMutation();
  const deleteMutation = useDeleteRecordMutation();
  const [busyMedName, setBusyMedName] = useState<string | null>(null);
  // 同步防重入锁：防止高频连点常用补剂胶囊发出重复用药写入请求。
  const quickMedLockRef = useRef(false);

  const quickMedicines = (defaultsQuery.data?.health.recent_medicines ?? []).slice(0, 3);

  async function handleQuickMedicine(med: MedicinePreset) {
    if (quickMedLockRef.current || busyMedName) return;
    quickMedLockRef.current = true;
    setBusyMedName(med.name);
    const recordedAt = new Date().toISOString();
    const timeText = formatLocalTimeFromISO(recordedAt);

    try {
      const created = await saveMutation.mutateAsync({
        category: 'health',
        payload: {
          subtype: 'medicine',
          medicine_name: med.name,
          medicine_dosage: med.dosage || null,
          recorded_at: recordedAt,
          note: '',
        },
      });
      let undone = false;
      toast.success(`已记录 · ${med.name}${med.dosage ? `（${med.dosage}）` : ''}`, `记录时间 ${timeText}`, {
        action: {
          label: '撤销',
          onClick: () => {
            if (undone) return;
            undone = true;
            void deleteMutation
              .mutateAsync({ category: 'health', id: created.id })
              .then(() => toast.info('已撤销刚才的用药记录'))
              .catch((cause) =>
                toast.error('撤销失败', cause instanceof Error ? cause.message : '请在下方列表中手动删除。'),
              );
          },
        },
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '快捷记录失败，请稍后重试');
    } finally {
      quickMedLockRef.current = false;
      setBusyMedName(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {quickMedicines.length > 0 ? (
        <section
          aria-label="常用补剂与用药一键直记"
          className="flex flex-col gap-2.5 rounded-2xl border border-health/30 bg-card px-4 py-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Zap className="size-3.5 shrink-0 text-health" />
            <span>常用用药 / 补剂一键直记</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {quickMedicines.map((med) => {
              const busy = busyMedName === med.name;
              return (
                <button
                  key={med.name}
                  type="button"
                  disabled={busyMedName !== null}
                  onClick={() => void handleQuickMedicine(med)}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-health/40 bg-health-soft/55 px-3 text-xs font-medium text-health-soft-foreground transition-colors outline-none hover:border-health/75 hover:bg-health-soft focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:h-7"
                >
                  {busy ? (
                    <Spinner className="size-3" aria-hidden="true" role="presentation" />
                  ) : (
                    <Pill className="size-3 shrink-0" />
                  )}
                  <span>
                    {med.name}
                    {med.dosage ? ` · ${med.dosage}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <RecordListPage
        category="health"
        title={META.pageTitle}
        icon={META.icon}
        badgeClassName={META.softClass}
        createButtonLabel={META.createLabel}
        defaultRange="30d"
        allSubtypeFilter="temperature,medicine"
        subtypeTabs={SUBTYPE_TABS}
        loadErrorFallback="无法加载健康记录"
        emptyTitle="当前范围内还没有健康记录"
        emptyDescription="把体温变化、退烧或维 D 用药时间记在一起，随时查看。"
        deleteDialogTitle="确认删除这条健康记录？"
        deleteSuccessToast="健康记录已删除"
        getDateKey={(rec) => getLocalDateKeyFromISO(rec.recorded_at)}
        formatDailySummary={formatHealthSummary}
        describeRow={describeHealth}
        formatDeleteDescription={(rec) => {
          const info = describeHealth(rec);
          return `将删除 ${formatLocalDateTimeShort(rec.recorded_at)} 的「${info.badge} · ${info.title}」，删除后不可恢复。`;
        }}
      />
    </div>
  );
}
