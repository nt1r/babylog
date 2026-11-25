import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, PlusIcon, RotateCw, Syringe } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ListPageCard } from '@/components/list-page-card';
import { Button } from '@/components/ui/button';
import { QuickChip } from '@/components/ui/choice-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { VaccineBatchDrawer } from '@/components/vaccines/vaccine-batch-drawer';
import { VaccineCatalogDrawer } from '@/components/vaccines/vaccine-catalog-drawer';
import {
  type BatchDrawerIntent,
  type BirthConfirmItem,
  validateAndBuildBirthConfirmRequests,
} from '@/components/vaccines/vaccine-codec';
import { VaccineDetailDrawer } from '@/components/vaccines/vaccine-detail-drawer';
import { VaccineOverview } from '@/components/vaccines/vaccine-overview';
import { VaccineTimeline } from '@/components/vaccines/vaccine-timeline';
import { useBabyProfileQuery } from '@/lib/baby';
import {
  filterVaccineDoses,
  useUpdateDefaultClinicMutation,
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
  const updateDefaultClinicMutation = useUpdateDefaultClinicMutation();

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
  const timelineAnchorRef = useRef<HTMLDivElement>(null);

  function jumpToFilteredTimeline(nextStatus: VaccineStatusFilter) {
    setStatusFilter(nextStatus);
    setCategoryFilter('all');
    timelineAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  // 交叉统计各筛选维度命中剂次，点击前即可直观看到目标分组数量。
  const statusCounts = useMemo(() => {
    if (!overview) return {} as Record<VaccineStatusFilter, number>;
    return {
      all: filterVaccineDoses(overview.doses, 'all', categoryFilter).length,
      attention: filterVaccineDoses(overview.doses, 'attention', categoryFilter).length,
      scheduled: filterVaccineDoses(overview.doses, 'scheduled', categoryFilter).length,
      pending: filterVaccineDoses(overview.doses, 'pending', categoryFilter).length,
      completed: filterVaccineDoses(overview.doses, 'completed', categoryFilter).length,
    };
  }, [overview, categoryFilter]);

  const categoryCounts = useMemo(() => {
    if (!overview) return {} as Record<VaccineCategoryFilter, number>;
    return {
      all: filterVaccineDoses(overview.doses, statusFilter, 'all').length,
      nip: filterVaccineDoses(overview.doses, statusFilter, 'nip').length,
      optional: filterVaccineDoses(overview.doses, statusFilter, 'optional').length,
    };
  }, [overview, statusFilter]);

  const hasActiveFilter = statusFilter !== 'all' || categoryFilter !== 'all';

  function openDoseDetail(dose: VaccineDose) {
    setSelectedDoseId(dose.id);
    setDetailOpen(true);
  }

  function openBatchDrawer(
    action: 'schedule' | 'complete',
    doseIds: number[],
    stageLabel: string,
    defaultDate: string,
    defaultClinic?: string,
  ) {
    setBatchIntent({ action, doseIds, stageLabel, defaultDate, defaultClinic });
    setBatchOpen(true);
  }

  async function handleSaveDefaultClinic(clinicName: string): Promise<boolean> {
    try {
      const res = await updateDefaultClinicMutation.mutateAsync(clinicName);
      toast.success(res.default_clinic_name ? `已将「${res.default_clinic_name}」设为常去门诊` : '已清除常去接种门诊');
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
      return false;
    }
  }

  async function handleConfirmBirthDoses(items: readonly BirthConfirmItem[]) {
    if (birthConfirmLockRef.current || !overview || items.length === 0) {
      return;
    }
    const result = validateAndBuildBirthConfirmRequests(items, overview.birth_date, overview.today);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    birthConfirmLockRef.current = true;
    setConfirmingBirth(true);
    try {
      // 产院乙肝第 1 剂（常为出生当天）与卡介苗（常为出生次日）可能接种日期不同，逐剂按各自确认日期落库。
      for (const req of result.requests) {
        await updateDoseMutation.mutateAsync(req);
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
            savingDefaultClinic={updateDefaultClinicMutation.isPending}
            onConfirmBirthDoses={(items) => void handleConfirmBirthDoses(items)}
            onDismissBirthConfirm={() => setBirthConfirmDismissed(true)}
            onSaveDefaultClinic={handleSaveDefaultClinic}
            onOpenDose={openDoseDetail}
            onOpenBatchScheduleFocus={(doseIds, label, defaultDate) =>
              openBatchDrawer('schedule', doseIds, label, defaultDate)
            }
            onOpenBatchCompleteFocus={(doseIds, label, defaultDate, defaultClinic) =>
              openBatchDrawer('complete', doseIds, label, defaultDate, defaultClinic)
            }
            onSelectStatusFilter={jumpToFilteredTimeline}
          />

          <div ref={timelineAnchorRef} className="scroll-mt-20">
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
                  {STATUS_FILTER_OPTIONS.map((opt) => {
                    const count = statusCounts[opt.value] ?? 0;
                    return (
                      <QuickChip
                        key={opt.value}
                        variant="outline"
                        active={statusFilter === opt.value}
                        onClick={() => setStatusFilter(opt.value)}
                        className="gap-1"
                      >
                        <span>{opt.label}</span>
                        {opt.value !== 'all' && count > 0 ? (
                          <span className="text-xs opacity-75 tabular-nums">{count}</span>
                        ) : null}
                      </QuickChip>
                    );
                  })}
                </fieldset>

                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                  <fieldset aria-label="疫苗类别筛选" className="flex flex-wrap items-center gap-1.5 border-0 p-0">
                    {CATEGORY_FILTER_OPTIONS.map((opt) => {
                      const count = categoryCounts[opt.value] ?? 0;
                      return (
                        <QuickChip
                          key={opt.value}
                          variant="outline"
                          tone="health"
                          active={categoryFilter === opt.value}
                          onClick={() => setCategoryFilter(opt.value)}
                          className="gap-1"
                        >
                          <span>{opt.label}</span>
                          {opt.value !== 'all' && count > 0 ? (
                            <span className="text-xs opacity-75 tabular-nums">{count}</span>
                          ) : null}
                        </QuickChip>
                      );
                    })}
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
                hasActiveFilter={hasActiveFilter}
                onResetFilters={() => {
                  setStatusFilter('all');
                  setCategoryFilter('all');
                }}
                onSelectDose={openDoseDetail}
                onBatchSchedule={(ids, label, defaultDate) => openBatchDrawer('schedule', ids, label, defaultDate)}
                onBatchComplete={(ids, label, defaultDate) => openBatchDrawer('complete', ids, label, defaultDate)}
              />
            </ListPageCard>
          </div>

          <VaccineDetailDrawer
            open={detailOpen}
            dose={selectedDose}
            allDoses={overview.doses}
            birthDate={overview.birth_date}
            today={overview.today}
            defaultClinicName={overview.default_clinic_name}
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
            defaultClinicName={overview.default_clinic_name}
            recentClinics={overview.recent_clinics}
            onOpenChange={setBatchOpen}
          />
        </>
      )}
    </div>
  );
}
