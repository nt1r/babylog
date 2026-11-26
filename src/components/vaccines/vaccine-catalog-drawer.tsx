import { ChevronUp, PlusIcon, SlidersHorizontal, Syringe, Trash2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { EntityDrawer } from '@/components/entity-drawer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceCardButton } from '@/components/ui/choice-controls';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { DoseScheduleEditor } from '@/components/vaccines/dose-schedule-editor';
import {
  createInitialCustomRows,
  createRowsFromTemplate,
  type EditableDoseRow,
  validateAndBuildCustomVaccine,
  validateAndBuildTemplateAdd,
} from '@/components/vaccines/vaccine-codec';
import { cn } from '@/lib/utils';
import {
  useAddVaccineTemplateMutation,
  useCreateCustomVaccineMutation,
  useDeleteVaccineTemplateMutation,
  useVaccineCatalogQuery,
  type VaccineCatalogItem,
  type VaccineCategory,
} from '@/lib/vaccines';

interface VaccineCatalogDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** 自费疫苗模板库（含默认剂次明细、按需调删后加入与整套移出）及多剂自定义疫苗新增抽屉。 */
export function VaccineCatalogDrawer({ open, onOpenChange }: VaccineCatalogDrawerProps) {
  const catalogQuery = useVaccineCatalogQuery(open);
  const addTemplateMutation = useAddVaccineTemplateMutation();
  const deleteTemplateMutation = useDeleteVaccineTemplateMutation();
  const createCustomMutation = useCreateCustomVaccineMutation();

  const [tab, setTab] = useState<'templates' | 'custom'>('templates');
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, EditableDoseRow[]>>({});
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [addingCode, setAddingCode] = useState<string | null>(null);
  const [removingTemplate, setRemovingTemplate] = useState<VaccineCatalogItem | null>(null);

  // 同步防重入锁：在 React 状态更新触发按钮禁用前的同一帧内拦截连点，防止重复提交同一模板。
  const addLockRef = useRef(false);

  // 自定义疫苗多剂次表单
  const [vaccineName, setVaccineName] = useState('');
  const [category, setCategory] = useState<VaccineCategory>('optional');
  const [customRows, setCustomRows] = useState<EditableDoseRow[]>(createInitialCustomRows);
  const [note, setNote] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const busy = addTemplateMutation.isPending || deleteTemplateMutation.isPending || createCustomMutation.isPending;

  function clearTemplateDraft(code: string) {
    setTemplateDrafts((prev) => {
      if (!(code in prev)) return prev;
      const next = { ...prev };
      delete next[code];
      return next;
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    if (!nextOpen) {
      setExpandedCode(null);
      setTemplateError(null);
    }
    onOpenChange(nextOpen);
  }

  function toggleTemplateEditor(tpl: VaccineCatalogItem) {
    setTemplateError(null);
    if (expandedCode === tpl.code) {
      setExpandedCode(null);
      clearTemplateDraft(tpl.code);
      return;
    }
    setTemplateDrafts((prev) => ({ ...prev, [tpl.code]: createRowsFromTemplate(tpl) }));
    setExpandedCode(tpl.code);
  }

  async function handleQuickAddTemplate(tpl: VaccineCatalogItem) {
    if (addLockRef.current || busy) return;
    addLockRef.current = true;
    setTemplateError(null);
    setAddingCode(tpl.code);
    try {
      await addTemplateMutation.mutateAsync({ templateCode: tpl.code });
      toast.success(`已将「${tpl.name}（共 ${tpl.dose_count} 剂）」加入计划`);
      if (expandedCode === tpl.code) {
        setExpandedCode(null);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '加入失败，请稍后重试');
    } finally {
      addLockRef.current = false;
      setAddingCode(null);
    }
  }

  async function handleConfirmAddTemplate(tpl: VaccineCatalogItem) {
    if (addLockRef.current || busy) return;
    const rows = templateDrafts[tpl.code] ?? createRowsFromTemplate(tpl);
    const result = validateAndBuildTemplateAdd(tpl, rows);
    if (!result.ok) {
      setTemplateError(result.error);
      return;
    }

    addLockRef.current = true;
    setTemplateError(null);
    setAddingCode(tpl.code);
    try {
      await addTemplateMutation.mutateAsync(result.request);
      toast.success(`已将「${tpl.name}（共 ${result.doseCount} 剂）」加入计划`);
      setExpandedCode(null);
      clearTemplateDraft(tpl.code);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '加入失败，请稍后重试');
    } finally {
      addLockRef.current = false;
      setAddingCode(null);
    }
  }

  async function handleConfirmRemoveTemplate() {
    if (!removingTemplate || deleteTemplateMutation.isPending) return;
    const target = removingTemplate;
    try {
      await deleteTemplateMutation.mutateAsync(target.code);
      clearTemplateDraft(target.code);
      setRemovingTemplate(null);
      toast.success(`已将「${target.name}」整套移出计划`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '移出失败，请稍后重试');
    }
  }

  async function handleCreateCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const result = validateAndBuildCustomVaccine(vaccineName, category, customRows, note);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }

    setCustomError(null);
    try {
      await createCustomMutation.mutateAsync(result.input);
      toast.success(`已添加「${result.input.vaccine_name}（共 ${result.input.doses.length} 剂）」`);
      setVaccineName('');
      setCustomRows(createInitialCustomRows());
      setNote('');
      onOpenChange(false);
    } catch (cause) {
      setCustomError(cause instanceof Error ? cause.message : '添加失败，请稍后重试');
    }
  }

  return (
    <>
      <EntityDrawer
        open={open}
        pending={busy}
        onOpenChange={handleOpenChange}
        title="添加疫苗"
        icon={<Syringe className="size-4.5 text-health" strokeWidth={1.8} />}
        className="md:max-w-lg"
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v === 'custom' ? 'custom' : 'templates')}>
          <TabsList className="w-full">
            <TabsTrigger value="templates" className="flex-1">
              常见自费
            </TabsTrigger>
            <TabsTrigger value="custom" className="flex-1">
              自定义
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
              <span>
                {catalogQuery.data
                  ? `共 ${catalogQuery.data.templates.length} 种常见自费疫苗，按需配置加入`
                  : '按门诊排期及说明书按需加入计划'}
              </span>
              <InfoPopover
                title="自费疫苗选型须知"
                label="选苗须知"
                triggerVariant="pill"
                tone="warning"
                align="end"
                disabled={busy}
              >
                <div className="space-y-2.5">
                  <p className="rounded-xl border border-warning/25 bg-warning-soft/55 px-3 py-2 text-warning-soft-foreground">
                    {catalogQuery.data?.disclaimer ??
                      '自费疫苗因品牌与起始月龄不同，剂次间隔差异较大；加入后请按门诊排期及说明书核对。'}
                  </p>
                  <p>展开任意疫苗卡片可按门诊实际方案调整月龄或增删剂次；加入后也可随时在详情或此处整套移出。</p>
                </div>
              </InfoPopover>
            </div>

            {catalogQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full rounded-2xl" />
                <Skeleton className="h-24 w-full rounded-2xl" />
              </div>
            ) : catalogQuery.isError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive-soft/30 p-4 text-xs text-destructive-soft-foreground">
                {catalogQuery.error instanceof Error ? catalogQuery.error.message : '加载自费疫苗库失败'}
              </div>
            ) : (
              <div className="space-y-2.5">
                {(catalogQuery.data?.templates ?? []).map((tpl) => {
                  const isExpanded = expandedCode === tpl.code;
                  const isAdding = addingCode === tpl.code;
                  // 仅在卡片展开时读取草稿（toggleTemplateEditor 已在展开时初始化），避免折叠卡片渲染期产生副作用。
                  const draftRows = isExpanded ? (templateDrafts[tpl.code] ?? []) : [];
                  const doseTips = tpl.doses.filter((d) => Boolean(d.dose_tip));

                  return (
                    <div
                      key={tpl.code}
                      className={cn(
                        'space-y-2.5 rounded-2xl border p-3.5 transition-colors',
                        tpl.added ? 'border-border/65 bg-muted/20' : 'border-border/80 bg-card',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="text-sm font-semibold text-foreground">{tpl.name}</h3>
                            {tpl.added ? (
                              <Badge variant="success">已加入 · {tpl.added_dose_count} 剂</Badge>
                            ) : (
                              <Badge variant="health">默认 {tpl.dose_count} 剂</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-xs text-muted-foreground">
                              预防：{tpl.prevents} · {tpl.route}
                            </p>
                            <InfoPopover
                              title={`${tpl.name} · 注意事项`}
                              description={`预防：${tpl.prevents}（${tpl.route}）`}
                              label="注意事项"
                              triggerVariant="pill"
                              tone="warning"
                              align="start"
                              disabled={busy}
                              triggerClassName="h-6 px-2"
                            >
                              <div className="space-y-3">
                                <div className="space-y-1">
                                  <p className="font-medium text-foreground">风险与选型提示</p>
                                  <p className="rounded-xl border border-warning/25 bg-warning-soft/55 px-3 py-2 text-warning-soft-foreground">
                                    {tpl.risk_warning}
                                  </p>
                                </div>

                                {doseTips.length > 0 ? (
                                  <div className="space-y-1.5">
                                    <p className="font-medium text-foreground">各剂次参考说明</p>
                                    <ul className="space-y-1.5">
                                      {doseTips.map((d) => (
                                        <li key={d.dose_number} className="flex items-start gap-1.5">
                                          <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground tabular-nums">
                                            第{d.dose_number}剂 · {d.age_label}
                                          </span>
                                          <span>{d.dose_tip}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}

                                <p className="border-t border-border/60 pt-2 text-xs text-muted-foreground">
                                  仅供参考，请以疫苗说明书及接种门诊医嘱为准。
                                </p>
                              </div>
                            </InfoPopover>
                          </div>
                        </div>

                        {tpl.added ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setRemovingTemplate(tpl)}
                            className="shrink-0 text-destructive hover:bg-destructive-soft hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                            移出计划
                          </Button>
                        ) : isExpanded ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => toggleTemplateEditor(tpl)}
                            className="shrink-0"
                          >
                            收起
                            <ChevronUp className="size-3.5" />
                          </Button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => toggleTemplateEditor(tpl)}
                              className="px-2.5 text-muted-foreground hover:text-foreground"
                            >
                              <SlidersHorizontal className="size-3.5" />
                              自定义
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleQuickAddTemplate(tpl)}
                            >
                              {isAdding ? (
                                <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
                              ) : (
                                <PlusIcon className="size-3.5" />
                              )}
                              {isAdding ? '加入中…' : '加入'}
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* 展开前展示默认排期的各剂适龄月龄胶囊，方便一眼看清剂次数与月龄 */}
                      {!isExpanded ? (
                        <div className="flex flex-wrap gap-1.5">
                          {tpl.doses.map((d) => (
                            <span
                              key={d.dose_number}
                              className="inline-flex items-center rounded-full border border-border/75 bg-muted/40 px-2.5 py-0.5 text-xs text-foreground tabular-nums"
                            >
                              第{d.dose_number}剂 · {d.age_label}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {isExpanded && !tpl.added ? (
                        <div className="space-y-3 border-t border-border/70 pt-3">
                          {templateError ? (
                            <Alert variant="destructive">
                              <AlertDescription>{templateError}</AlertDescription>
                            </Alert>
                          ) : null}

                          <DoseScheduleEditor
                            rows={draftRows}
                            disabled={busy}
                            onChange={(nextRows) => {
                              setTemplateError(null);
                              setTemplateDrafts((prev) => ({ ...prev, [tpl.code]: nextRows }));
                            }}
                            onResetDefaults={() => {
                              setTemplateError(null);
                              setTemplateDrafts((prev) => ({ ...prev, [tpl.code]: createRowsFromTemplate(tpl) }));
                            }}
                          />

                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setExpandedCode(null);
                                clearTemplateDraft(tpl.code);
                              }}
                            >
                              取消
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleConfirmAddTemplate(tpl)}
                            >
                              {isAdding ? (
                                <Spinner className="size-3.5" aria-hidden="true" role="presentation" />
                              ) : (
                                <PlusIcon className="size-3.5" />
                              )}
                              {isAdding ? '加入中…' : `确认加入（共 ${draftRows.length} 剂）`}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="custom" className="mt-3">
            <form onSubmit={handleCreateCustom} noValidate className="space-y-4">
              {customError ? (
                <Alert variant="destructive">
                  <AlertDescription>{customError}</AlertDescription>
                </Alert>
              ) : null}

              <FieldGroup className="space-y-3.5">
                <Field>
                  <FieldLabel htmlFor="custom-vac-name">疫苗名称</FieldLabel>
                  <Input
                    id="custom-vac-name"
                    value={vaccineName}
                    maxLength={60}
                    placeholder="如 五联疫苗 / AC流脑结合 / 甲肝灭活"
                    onChange={(e) => setVaccineName(e.target.value)}
                  />
                </Field>

                <div className="space-y-2">
                  <p className="text-[13px] font-medium text-foreground">疫苗类型</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: 'optional', label: '自费（非免疫规划）' },
                        { value: 'nip', label: '免费（地方/免疫规划）' },
                      ] as const
                    ).map((item) => (
                      <ChoiceCardButton
                        key={item.value}
                        active={category === item.value}
                        onClick={() => setCategory(item.value)}
                      >
                        {item.label}
                      </ChoiceCardButton>
                    ))}
                  </div>
                </div>

                <DoseScheduleEditor
                  rows={customRows}
                  disabled={busy}
                  onChange={(nextRows) => {
                    setCustomError(null);
                    setCustomRows(nextRows);
                  }}
                />

                <Field>
                  <FieldLabel htmlFor="custom-vac-note">备注（可选）</FieldLabel>
                  <Input
                    id="custom-vac-note"
                    value={note}
                    maxLength={500}
                    placeholder="如 社区门诊排期说明、注意事项"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
              </FieldGroup>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {createCustomMutation.isPending ? (
                    <Spinner className="size-4" aria-hidden="true" role="presentation" />
                  ) : (
                    <PlusIcon className="size-4" />
                  )}
                  {createCustomMutation.isPending ? '添加中…' : `添加到计划（共 ${customRows.length} 剂）`}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </EntityDrawer>

      <DeleteConfirmDialog
        open={removingTemplate !== null}
        onOpenChange={(next) => {
          if (!next && deleteTemplateMutation.isPending) return;
          if (!next) setRemovingTemplate(null);
        }}
        title="确认整套移出该自费疫苗？"
        description={
          removingTemplate
            ? `将移除「${removingTemplate.name}」在计划中的全部 ${removingTemplate.added_dose_count} 剂（含已登记预约或接种记录），移出后不可恢复，但可随时重新加入。`
            : ''
        }
        confirmLabel={deleteTemplateMutation.isPending ? '移出中…' : '确认移出'}
        pending={deleteTemplateMutation.isPending}
        onConfirm={handleConfirmRemoveTemplate}
      />
    </>
  );
}
