import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, PlusIcon, RotateCw, Syringe } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { QuickChip } from '@/components/ui/choice-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { type BatchDrawerIntent, VaccineBatchDrawer } from '@/components/vaccines/vaccine-batch-drawer';
import { VaccineCatalogDrawer } from '@/components/vaccines/vaccine-catalog-drawer';
import { VaccineDetailDrawer } from '@/components/vaccines/vaccine-detail-drawer';
import { type BirthConfirmItem, VaccineOverview } from '@/components/vaccines/vaccine-overview';
import { VaccineTimeline } from '@/components/vaccines/vaccine-timeline';
import { useBabyProfileQuery } from '@/lib/baby';
import {
  filterVaccineDoses,
  useUpdateVaccineDoseMutation,
  useVaccinesOverviewQuery,
  type VaccineCategoryFilter,
  type VaccineDose,
  type VaccineStatusFilter,
} from '@/lib/vaccines';

export const Route = createFileRoute('/_app/vaccines')({
  component: VaccinesPage,
});

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: VaccineStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'attention', label: '待关注' },
  { value: 'scheduled', label: '已预约' },
  { value: 'pending', label: '待接种' },
  { value: 'completed', label: '已接种' },
];

const CATEGORY_FILTER_OPTIONS: ReadonlyArray<{ value: VaccineCategoryFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'nip', label: '免费' },
  { value: 'optional', label: '自费' },
];

function VaccinesPage() {
  const babyQuery = useBabyProfileQuery();
  const overviewQuery = useVaccinesOverviewQuery();
  const updateDoseMutation = useUpdateVaccineDoseMutation();

  const [statusFilter, setStatusFilter] = useState<VaccineStatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<VaccineCategoryFilter>('all');
  const [birthConfirmDismissed, setBirthConfirmDismissed] = useState(false);

  const [selectedDoseId, setSelectedDoseId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [batchIntent, setBatchIntent] = useState<BatchDrawerIntent | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [confirmingBirth, setConfirmingBirth] = useState(false);
  // 同步防重入锁：防止产院疫苗一键确认按钮在禁用态生效前被连续点击发出重复请求。
  const birthConfirmLockRef = useRef(false);

  const overview = overviewQuery.data;
  const baby = babyQuery.data;

  const selectedDose: VaccineDose | null = useMemo(() => {
    if (!overview || selectedDoseId === null) return null;
    return overview.doses.find((d) => d.id === selectedDoseId) ?? null;
  }, [overview, selectedDoseId]);

  const filteredDoses = useMemo(() => {
    if (!overview) return [];
    return filterVaccineDoses(overview.doses, statusFilter, categoryFilter);
  }, [overview, statusFilter, categoryFilter]);

  function openDoseDetail(dose: VaccineDose) {
    setSelectedDoseId(dose.id);
    setDetailOpen(true);
  }

  function openBatchDrawer(
    action: 'schedule' | 'complete',
    doseIds: number[],
    stageLabel: string,
    defaultDate: string,
  ) {
    setBatchIntent({ action, doseIds, stageLabel, defaultDate });
    setBatchOpen(true);
  }

  async function handleConfirmBirthDoses(items: readonly BirthConfirmItem[]) {
    if (birthConfirmLockRef.current || !overview || items.length === 0) {
      return;
    }
    // 串行逐剂提交前先对全部勾选剂次统一预校验日期范围，避免第 1 剂落库后第 2 剂因越界报 400 导致半成功状态。
    for (const { dose, vaccinatedAt } of items) {
      if (!vaccinatedAt) {
        toast.error(`请填写「${dose.short_name}」的实际接种日期`);
        return;
      }
      if (vaccinatedAt < overview.birth_date || vaccinatedAt > overview.today) {
        toast.error(`「${dose.short_name}」的接种日期需在出生日期至今天之间`);
        return;
      }
    }
    birthConfirmLockRef.current = true;
    setConfirmingBirth(true);
    try {
      // 产院乙肝第 1 剂（常为出生当天）与卡介苗（常为出生次日）可能接种日期不同，逐剂按各自确认日期落库。
      for (const { dose, vaccinatedAt } of items) {
        await updateDoseMutation.mutateAsync({
          id: dose.id,
          input: {
            status: 'completed',
            planned_date: dose.planned_date,
            scheduled_date: null,
            scheduled_time: null,
            clinic_name: dose.clinic_name,
            vaccinated_at: vaccinatedAt,
            site: dose.site,
            manufacturer: dose.manufacturer,
            batch_no: dose.batch_no,
            reaction: dose.reaction,
            note: dose.note,
          },
        });
      }
      toast.success(`已确认 ${items.length} 剂产院疫苗记录`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '确认失败，请稍后重试');
    } finally {
      birthConfirmLockRef.current = false;
      setConfirmingBirth(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {overviewQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-5">
            <Skeleton className="h-80 w-full rounded-2xl @4xl/main:col-span-3" />
            <Skeleton className="h-80 w-full rounded-2xl @4xl/main:col-span-2" />
          </div>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      ) : overviewQuery.isError || !overview ? (
        <ListPageCard
          title="疫苗接种"
          badge={
            <span className="flex size-7 items-center justify-center rounded-lg bg-health-soft text-health-soft-foreground">
              <Syringe className="size-4" strokeWidth={1.8} />
            </span>
          }
        >
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/30 bg-destructive-soft/25 px-6 py-10 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="text-sm text-destructive-soft-foreground">
              {overviewQuery.error instanceof Error ? overviewQuery.error.message : '无法加载疫苗接种计划'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void overviewQuery.refetch()}>
              <RotateCw className="size-3.5" />
              重新加载
            </Button>
          </div>
        </ListPageCard>
      ) : (
        <>
          <VaccineOverview
            overview={overview}
            babyNickname={baby?.nickname}
            birthConfirmDismissed={birthConfirmDismissed}
            confirmingBirth={confirmingBirth}
            onConfirmBirthDoses={(items) => void handleConfirmBirthDoses(items)}
            onDismissBirthConfirm={() => setBirthConfirmDismissed(true)}
            onOpenDose={openDoseDetail}
            onOpenBatchScheduleFocus={(doseIds, label, defaultDate) =>
              openBatchDrawer('schedule', doseIds, label, defaultDate)
            }
          />

          <ListPageCard
            title="按月龄接种计划"
            badge={
              <span className="flex size-7 items-center justify-center rounded-lg bg-health-soft text-health-soft-foreground">
                <Syringe className="size-4" strokeWidth={1.8} />
              </span>
            }
            headerAction={
              <Button size="sm" onClick={() => setCatalogOpen(true)}>
                <PlusIcon className="size-4" />
                添加疫苗
              </Button>
            }
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <fieldset aria-label="疫苗状态筛选" className="flex flex-wrap items-center gap-1.5 border-0 p-0">
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <QuickChip
                    key={opt.value}
                    variant="outline"
                    active={statusFilter === opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                  >
                    {opt.label}
                  </QuickChip>
                ))}
              </fieldset>

              <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                <fieldset aria-label="疫苗类别筛选" className="flex flex-wrap items-center gap-1.5 border-0 p-0">
                  {CATEGORY_FILTER_OPTIONS.map((opt) => (
                    <QuickChip
                      key={opt.value}
                      variant="outline"
                      tone="health"
                      active={categoryFilter === opt.value}
                      onClick={() => setCategoryFilter(opt.value)}
                    >
                      {opt.label}
                    </QuickChip>
                  ))}
                </fieldset>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs md:hidden"
                  onClick={() => setCatalogOpen(true)}
                >
                  <PlusIcon className="size-3.5" />
                  添加疫苗
                </Button>
              </div>
            </div>

            <VaccineTimeline
              doses={filteredDoses}
              today={overview.today}
              onSelectDose={openDoseDetail}
              onBatchSchedule={(ids, label, defaultDate) => openBatchDrawer('schedule', ids, label, defaultDate)}
              onBatchComplete={(ids, label, defaultDate) => openBatchDrawer('complete', ids, label, defaultDate)}
            />
          </ListPageCard>

          <VaccineDetailDrawer
            open={detailOpen}
            dose={selectedDose}
            birthDate={overview.birth_date}
            today={overview.today}
            recentClinics={overview.recent_clinics}
            onOpenChange={setDetailOpen}
          />

          <VaccineCatalogDrawer open={catalogOpen} onOpenChange={setCatalogOpen} />

          <VaccineBatchDrawer
            open={batchOpen}
            intent={batchIntent}
            allDoses={overview.doses}
            birthDate={overview.birth_date}
            today={overview.today}
            recentClinics={overview.recent_clinics}
            onOpenChange={setBatchOpen}
          />
        </>
      )}
    </div>
  );
}
