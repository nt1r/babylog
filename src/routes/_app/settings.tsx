import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import {
  AlertCircle,
  Baby,
  CheckIcon,
  ChevronDown,
  DownloadIcon,
  Eye,
  EyeOff,
  KeyRound,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  RotateCcw,
  SaveIcon,
  ShareIcon,
  ShieldCheck,
  SmartphoneIcon,
  SunIcon,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { AddBabyDialog } from '@/components/baby/add-baby-dialog';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { PasswordLengthHint } from '@/components/password-length-hint';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QuickChip } from '@/components/ui/choice-controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useLogoutAction } from '@/hooks/use-logout';
import {
  type ChangePasswordValidationErrors,
  changePassword,
  PASSWORD_MIN_LENGTH,
  validateChangePasswordForm,
} from '@/lib/auth';
import {
  BABY_GENDER_LABELS,
  type BabyFormValidationErrors,
  type BabyGender,
  MAX_BABIES_PER_USER,
  useActiveBaby,
  useDeleteBabyMutation,
  useUpdateBabyMutation,
  validateBabyProfileForm,
} from '@/lib/baby';
import { triggerPwaInstall, usePwaInstallState } from '@/lib/pwa';
import { formatBabyAge } from '@/lib/time';
import { cn, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { type ThemeMode, usePreferencesStore } from '@/stores/preferences';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof SunIcon;
}> = [
  {
    value: 'light',
    label: '浅色模式',
    description: '温暖明亮，适合白天浏览。',
    icon: SunIcon,
  },
  {
    value: 'dark',
    label: '深色护眼',
    description: '柔和暗调，夜间喂奶不刺眼。',
    icon: MoonIcon,
  },
  {
    value: 'system',
    label: '跟随系统',
    description: '随设备系统深浅色自动切换。',
    icon: MonitorIcon,
  },
];

const GENDER_OPTIONS: ReadonlyArray<BabyGender> = ['male', 'female', 'unknown'];

function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);
  const { confirmOpen, setConfirmOpen, pending, confirmLogout } = useLogoutAction();

  const { babies, activeBaby: baby, selectBaby } = useActiveBaby();
  const updateBaby = useUpdateBabyMutation();
  const deleteBaby = useDeleteBabyMutation();
  const { standalone, canPromptInstall, isIOS } = usePwaInstallState();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<BabyGender>('unknown');
  const [birthWeight, setBirthWeight] = useState('');
  const [birthHeight, setBirthHeight] = useState('');
  const [defaultClinicName, setDefaultClinicName] = useState('');
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<BabyFormValidationErrors>({});

  // 新增宝宝、切娃未保存确认 & 删除宝宝确认弹窗（保留目标快照，避免退场动画标题闪烁）
  const [addBabyOpen, setAddBabyOpen] = useState(false);
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);
  const [pendingSwitchBaby, setPendingSwitchBaby] = useState<{ id: number; nickname: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; nickname: string } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // 自助修改密码状态（折叠收纳在「账号与安全」卡片内，减轻移动端纵向滚动）
  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordSubmitError, setPasswordSubmitError] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<ChangePasswordValidationErrors>({});

  const serverBabyKey = baby ? `${baby.id}:${baby.updated_at}` : null;

  // 与服务端档案实时比对计算真实的未保存修改态，切换不同宝宝时强制重新回填。
  const isDirty = Boolean(
    baby &&
      hydratedKey === serverBabyKey &&
      (nickname !== baby.nickname ||
        birthDate !== baby.birth_date ||
        gender !== baby.gender ||
        birthWeight !== (baby.birth_weight_kg !== null ? String(baby.birth_weight_kg) : '') ||
        birthHeight !== (baby.birth_height_cm !== null ? String(baby.birth_height_cm) : '') ||
        defaultClinicName !== (baby.default_clinic_name ?? '')),
  );

  // 仅在切换宝宝或服务端档案版本更新（serverBabyKey 变化）时同步表单，避免把字段改回原值时误清校验提示。
  useEffect(() => {
    if (!baby || !serverBabyKey) {
      setHydratedKey(null);
      return;
    }
    if (hydratedKey === serverBabyKey) return;
    setNickname(baby.nickname);
    setBirthDate(baby.birth_date);
    setGender(baby.gender);
    setBirthWeight(baby.birth_weight_kg !== null ? String(baby.birth_weight_kg) : '');
    setBirthHeight(baby.birth_height_cm !== null ? String(baby.birth_height_cm) : '');
    setDefaultClinicName(baby.default_clinic_name ?? '');
    setHydratedKey(serverBabyKey);
    setFieldErrors({});
  }, [baby, serverBabyKey, hydratedKey]);

  function handleResetBabyDraft() {
    if (!baby) return;
    setNickname(baby.nickname);
    setBirthDate(baby.birth_date);
    setGender(baby.gender);
    setBirthWeight(baby.birth_weight_kg !== null ? String(baby.birth_weight_kg) : '');
    setBirthHeight(baby.birth_height_cm !== null ? String(baby.birth_height_cm) : '');
    setDefaultClinicName(baby.default_clinic_name ?? '');
    setFieldErrors({});
  }

  async function handleSaveBaby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!baby || updateBaby.isPending) return;

    const { payload, errors } = validateBabyProfileForm({
      nickname,
      birthDate,
      gender,
      birthWeight,
      birthHeight,
      defaultClinicName,
      todayStr,
    });
    if (!payload) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    try {
      const updated = await updateBaby.mutateAsync({ babyId: baby.id, input: payload });
      setNickname(updated.nickname);
      setBirthDate(updated.birth_date);
      setGender(updated.gender);
      setBirthWeight(updated.birth_weight_kg !== null ? String(updated.birth_weight_kg) : '');
      setBirthHeight(updated.birth_height_cm !== null ? String(updated.birth_height_cm) : '');
      setDefaultClinicName(updated.default_clinic_name ?? '');
      toast.success('宝宝档案已更新');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    }
  }

  function handleOpenDeleteDialog() {
    if (!baby) return;
    setDeleteTarget({ id: baby.id, nickname: baby.nickname });
    setDeleteConfirmInput('');
    setDeleteError('');
    setDeleteDialogOpen(true);
  }

  async function handleConfirmDeleteBaby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget || deleteBaby.isPending) return;
    if (deleteConfirmInput !== deleteTarget.nickname) return;

    const isLastBaby = babies.length <= 1;
    const deletedNickname = deleteTarget.nickname;
    setDeleteError('');
    try {
      await deleteBaby.mutateAsync(deleteTarget.id);
      setDeleteDialogOpen(false);
      setDeleteConfirmInput('');
      toast.success(`已永久删除「${deletedNickname}」的档案`);
      if (isLastBaby) {
        await navigate({ to: '/onboarding', replace: true });
      }
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除失败，请稍后重试。');
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordPending) return;

    const nextErrors = validateChangePasswordForm({
      currentPassword,
      newPassword,
      confirmPassword: confirmNewPassword,
      currentEmptyMessage: '请输入当前密码',
    });

    if (nextErrors.currentPassword || nextErrors.newPassword || nextErrors.confirmPassword) {
      setPasswordErrors(nextErrors);
      return;
    }

    setPasswordPending(true);
    setPasswordSubmitError('');
    setPasswordErrors({});
    try {
      const updatedUser = await changePassword(currentPassword, newPassword);
      setUser(updatedUser);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
      setPasswordSectionOpen(false);
      toast.success('密码已修改', '其他设备需使用新密码重新登录。');
    } catch (cause) {
      setPasswordSubmitError(cause instanceof Error ? cause.message : '修改密码失败，请稍后重试。');
    } finally {
      setPasswordPending(false);
    }
  }

  const username = user?.username ?? '当前账号';
  const ageInfo = baby ? formatBabyAge(baby.birth_date) : null;
  const atBabyLimit = babies.length >= MAX_BABIES_PER_USER;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only md:not-sr-only md:text-2xl md:font-semibold md:tracking-tight">偏好与账号</h1>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Baby className="size-4.5" strokeWidth={1.8} />
              </span>
              <div className="flex items-center gap-2">
                <CardTitle>宝宝档案</CardTitle>
                {babies.length > 1 ? (
                  <Badge variant="secondary" className="font-normal tabular-nums">
                    {babies.length} 位宝宝
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {ageInfo ? (
                <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
                  {ageInfo.daysLabel} · {ageInfo.ageLabel}
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={atBabyLimit}
                onClick={() => setAddBabyOpen(true)}
              >
                <PlusIcon className="size-3.5" />
                {atBabyLimit ? '已达上限' : '添加宝宝'}
              </Button>
            </div>
          </div>

          {babies.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {babies.map((item) => {
                const selected = item.id === baby?.id;
                return (
                  <QuickChip
                    key={item.id}
                    variant="outline"
                    active={selected}
                    disabled={updateBaby.isPending}
                    onClick={() => {
                      if (selected) return;
                      if (isDirty) {
                        setPendingSwitchBaby({ id: item.id, nickname: item.nickname });
                        setSwitchConfirmOpen(true);
                        return;
                      }
                      selectBaby(item.id);
                    }}
                    className="h-8 gap-1.5 px-3 text-xs"
                  >
                    <span>{item.nickname}</span>
                  </QuickChip>
                );
              })}
            </div>
          ) : null}
        </CardHeader>

        <CardContent>
          {baby ? (
            <form onSubmit={handleSaveBaby} noValidate className="space-y-4">
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field invalid={Boolean(fieldErrors.nickname)}>
                  <FieldLabel htmlFor="settings-baby-name">宝宝昵称</FieldLabel>
                  <Input
                    id="settings-baby-name"
                    value={nickname}
                    maxLength={32}
                    disabled={updateBaby.isPending}
                    aria-invalid={Boolean(fieldErrors.nickname)}
                    onChange={(event) => {
                      setNickname(event.target.value);
                      if (fieldErrors.nickname) setFieldErrors((prev) => ({ ...prev, nickname: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.nickname}</FieldError>
                </Field>

                <Field invalid={Boolean(fieldErrors.birthDate)}>
                  <FieldLabel htmlFor="settings-baby-birth">出生日期</FieldLabel>
                  <DatePicker
                    id="settings-baby-birth"
                    captionLayout="dropdown"
                    max={todayStr}
                    value={birthDate}
                    disabled={updateBaby.isPending}
                    invalid={Boolean(fieldErrors.birthDate)}
                    ariaLabel="出生日期"
                    drawerTitle="宝宝出生日期"
                    onChange={(nextDate) => {
                      setBirthDate(nextDate);
                      if (fieldErrors.birthDate) setFieldErrors((prev) => ({ ...prev, birthDate: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.birthDate}</FieldError>
                </Field>

                <div className="space-y-2 sm:col-span-2">
                  <p className="text-[13px] font-medium text-foreground">性别</p>
                  <div className="flex flex-wrap gap-2">
                    {GENDER_OPTIONS.map((g) => (
                      <QuickChip
                        key={g}
                        variant="outline"
                        active={gender === g}
                        disabled={updateBaby.isPending}
                        onClick={() => {
                          setGender(g);
                        }}
                        className="h-9 px-4 text-sm sm:h-9"
                      >
                        {BABY_GENDER_LABELS[g]}
                      </QuickChip>
                    ))}
                  </div>
                </div>

                <Field invalid={Boolean(fieldErrors.birthWeight)}>
                  <FieldLabel htmlFor="settings-baby-weight">出生体重（kg，可选）</FieldLabel>
                  <Input
                    id="settings-baby-weight"
                    type="number"
                    step="0.01"
                    min="0.3"
                    max="15"
                    inputMode="decimal"
                    disabled={updateBaby.isPending}
                    placeholder="如 3.35"
                    className="tabular-nums"
                    aria-invalid={Boolean(fieldErrors.birthWeight)}
                    value={birthWeight}
                    onChange={(event) => {
                      setBirthWeight(event.target.value);
                      if (fieldErrors.birthWeight) setFieldErrors((prev) => ({ ...prev, birthWeight: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.birthWeight}</FieldError>
                </Field>

                <Field invalid={Boolean(fieldErrors.birthHeight)}>
                  <FieldLabel htmlFor="settings-baby-height">出生身高（cm，可选）</FieldLabel>
                  <Input
                    id="settings-baby-height"
                    type="number"
                    step="0.1"
                    min="20"
                    max="100"
                    inputMode="decimal"
                    disabled={updateBaby.isPending}
                    placeholder="如 50.0"
                    className="tabular-nums"
                    aria-invalid={Boolean(fieldErrors.birthHeight)}
                    value={birthHeight}
                    onChange={(event) => {
                      setBirthHeight(event.target.value);
                      if (fieldErrors.birthHeight) setFieldErrors((prev) => ({ ...prev, birthHeight: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.birthHeight}</FieldError>
                </Field>

                <Field invalid={Boolean(fieldErrors.defaultClinicName)} className="sm:col-span-2">
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="settings-default-clinic">常去接种门诊（可选）</FieldLabel>
                    <InfoPopover title="常去接种门诊说明" ariaLabel="查看常去接种门诊说明">
                      <p>
                        设置后，在疫苗预约登记、打卡记录以及导出手机日历时会自动带出该门诊；也可随时在疫苗页行内修改或清空。
                      </p>
                    </InfoPopover>
                  </div>
                  <Input
                    id="settings-default-clinic"
                    value={defaultClinicName}
                    maxLength={80}
                    disabled={updateBaby.isPending}
                    placeholder="如 XX 街道社区卫生服务中心"
                    aria-invalid={Boolean(fieldErrors.defaultClinicName)}
                    onChange={(event) => {
                      setDefaultClinicName(event.target.value);
                      if (fieldErrors.defaultClinicName) {
                        setFieldErrors((prev) => ({ ...prev, defaultClinicName: undefined }));
                      }
                    }}
                  />
                  <FieldError>{fieldErrors.defaultClinicName}</FieldError>
                </Field>
              </FieldGroup>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-h-5">
                  {isDirty ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-soft-foreground">
                      <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                      有未保存的档案修改
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {isDirty ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={updateBaby.isPending}
                      onClick={handleResetBabyDraft}
                    >
                      <RotateCcw className="size-3.5" />
                      还原
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={updateBaby.isPending}>
                    {updateBaby.isPending ? (
                      <Spinner className="size-4" aria-hidden="true" role="presentation" />
                    ) : (
                      <SaveIcon className="size-4" />
                    )}
                    {updateBaby.isPending ? '保存中…' : '保存档案'}
                  </Button>
                </div>
              </div>

              <Separator className="my-2" />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/25 bg-destructive-soft/35 p-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">删除「{baby.nickname}」的档案</p>
                  <p className="text-xs text-muted-foreground">
                    将永久删除该宝宝的全部喂养、睡眠、护理、健康、生长与疫苗记录，无法恢复。
                  </p>
                </div>
                <Button type="button" variant="destructive" size="sm" onClick={handleOpenDeleteDialog}>
                  <Trash2 className="size-3.5" />
                  删除宝宝档案
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/25 p-5 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">当前账号尚未创建宝宝档案</p>
                <p className="text-xs text-muted-foreground">创建宝宝档案后即可开始记录喂养、睡眠、成长与疫苗接种。</p>
              </div>
              <Button type="button" onClick={() => setAddBabyOpen(true)}>
                <PlusIcon className="size-4" />
                创建宝宝档案
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>外观模式</CardTitle>
          <CardDescription>夜间照护推荐使用深色护眼模式。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = themeMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setThemeMode(option.value);
                  toast.success(`已切换为${option.label}`);
                }}
                className={cn(
                  'relative flex cursor-pointer flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-accent/70 text-accent-foreground'
                    : 'border-border/80 bg-background/50 hover:bg-muted/50',
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                    <Icon className="size-4.5" strokeWidth={1.8} />
                  </span>
                  {active ? (
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-3.5" strokeWidth={2.4} />
                    </span>
                  ) : null}
                </div>
                <span className="text-sm font-semibold text-foreground">{option.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{option.description}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* 已从主屏幕独立打开时不再重复展示安装引导 */}
      {!standalone ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <SmartphoneIcon className="size-4.5" strokeWidth={1.8} />
                </span>
                <div>
                  <CardTitle>添加到手机桌面</CardTitle>
                  <CardDescription>像独立应用一样全屏打开，日常记录更顺手。</CardDescription>
                </div>
              </div>

              {canPromptInstall ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const outcome = await triggerPwaInstall();
                      if (outcome === 'accepted') {
                        toast.success('已开始添加 BabyLog');
                      }
                    } catch {
                      toast.error('无法自动弹出安装窗口', '请通过浏览器菜单手动添加到桌面。');
                    }
                  }}
                >
                  <DownloadIcon className="size-4" />
                  添加到桌面
                </Button>
              ) : (
                <InfoPopover
                  title="添加到主屏幕指南"
                  label="查看步骤"
                  triggerVariant="pill"
                  align="end"
                  triggerClassName="h-8 px-3"
                >
                  {isIOS ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">在 Safari 添加到主屏幕：</p>
                      <ol className="list-decimal space-y-1.5 pl-4">
                        <li>
                          点击底部工具栏的
                          <span className="mx-1 inline-flex items-center gap-0.5 font-medium text-foreground">
                            <ShareIcon className="size-3.5" />
                            分享
                          </span>
                          按钮；
                        </li>
                        <li>
                          向下滑动选择<span className="mx-1 font-medium text-foreground">「添加到主屏幕」</span>
                          ，再点击右上角「添加」即可。
                        </li>
                      </ol>
                    </div>
                  ) : (
                    <p>
                      在手机浏览器菜单中选择「分享 →
                      添加到主屏幕」，或在桌面浏览器地址栏右侧点击安装图标，即可像独立应用一样打开。
                    </p>
                  )}
                </InfoPopover>
              )}
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>账号与安全</CardTitle>
          <CardDescription>管理当前登录账号与密码安全。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-10 rounded-2xl bg-primary/15 text-primary">
                <AvatarFallback className="text-sm">{getInitials(username)}</AvatarFallback>
              </Avatar>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{username}</p>
                {user?.role === 'admin' ? (
                  <Badge variant="default" className="gap-1 font-normal">
                    <ShieldCheck className="size-3" />
                    管理员
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="font-normal">
                    家庭成员
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={passwordSectionOpen}
                onClick={() => setPasswordSectionOpen((open) => !open)}
              >
                <KeyRound className="size-4" />
                修改密码
                <ChevronDown
                  className={cn('size-3.5 transition-transform duration-200', passwordSectionOpen && 'rotate-180')}
                  aria-hidden="true"
                />
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
                <LogOutIcon className="size-4" />
                退出登录
              </Button>
            </div>
          </div>

          <Collapsible open={passwordSectionOpen} onOpenChange={setPasswordSectionOpen}>
            <CollapsibleTrigger className="sr-only">展开或收起修改密码表单</CollapsibleTrigger>
            <CollapsibleContent>
              <div className="rounded-2xl border border-border/80 bg-background/60 p-4">
                <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                  改密后当前设备不受影响，其他设备需使用新密码重新登录。
                </p>
                <form onSubmit={handleChangePassword} noValidate className="space-y-4">
                  <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Field invalid={Boolean(passwordErrors.currentPassword)}>
                      <FieldLabel htmlFor="settings-current-password">当前密码</FieldLabel>
                      <InputGroup className="h-10">
                        <InputGroupInput
                          id="settings-current-password"
                          type={showCurrentPassword ? 'text' : 'password'}
                          value={currentPassword}
                          disabled={passwordPending}
                          autoComplete="current-password"
                          placeholder="请输入当前密码"
                          aria-invalid={Boolean(passwordErrors.currentPassword)}
                          onChange={(event) => {
                            setCurrentPassword(event.target.value);
                            setPasswordSubmitError('');
                            if (passwordErrors.currentPassword) {
                              setPasswordErrors((prev) => ({ ...prev, currentPassword: undefined }));
                            }
                          }}
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={passwordPending}
                            aria-label={showCurrentPassword ? '隐藏当前密码' : '显示当前密码'}
                            aria-pressed={showCurrentPassword}
                            onClick={() => setShowCurrentPassword((v) => !v)}
                          >
                            {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldError>{passwordErrors.currentPassword}</FieldError>
                    </Field>

                    <Field invalid={Boolean(passwordErrors.newPassword)}>
                      <FieldLabel htmlFor="settings-new-password">新密码（至少 {PASSWORD_MIN_LENGTH} 位）</FieldLabel>
                      <InputGroup className="h-10">
                        <InputGroupInput
                          id="settings-new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          disabled={passwordPending}
                          autoComplete="new-password"
                          placeholder="请输入新密码"
                          aria-invalid={Boolean(passwordErrors.newPassword)}
                          onChange={(event) => {
                            setNewPassword(event.target.value);
                            setPasswordSubmitError('');
                            if (passwordErrors.newPassword) {
                              setPasswordErrors((prev) => ({ ...prev, newPassword: undefined }));
                            }
                          }}
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={passwordPending}
                            aria-label={showNewPassword ? '隐藏新密码' : '显示新密码'}
                            aria-pressed={showNewPassword}
                            onClick={() => setShowNewPassword((v) => !v)}
                          >
                            {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldError>{passwordErrors.newPassword}</FieldError>
                      {!passwordErrors.newPassword ? <PasswordLengthHint value={newPassword} /> : null}
                    </Field>

                    <Field invalid={Boolean(passwordErrors.confirmPassword)}>
                      <FieldLabel htmlFor="settings-confirm-password">确认新密码</FieldLabel>
                      <InputGroup className="h-10">
                        <InputGroupInput
                          id="settings-confirm-password"
                          type={showConfirmNewPassword ? 'text' : 'password'}
                          value={confirmNewPassword}
                          disabled={passwordPending}
                          autoComplete="new-password"
                          placeholder="请再次输入新密码"
                          aria-invalid={Boolean(passwordErrors.confirmPassword)}
                          onChange={(event) => {
                            setConfirmNewPassword(event.target.value);
                            setPasswordSubmitError('');
                            if (passwordErrors.confirmPassword) {
                              setPasswordErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                            }
                          }}
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={passwordPending}
                            aria-label={showConfirmNewPassword ? '隐藏确认密码' : '显示确认密码'}
                            aria-pressed={showConfirmNewPassword}
                            onClick={() => setShowConfirmNewPassword((v) => !v)}
                          >
                            {showConfirmNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldError>{passwordErrors.confirmPassword}</FieldError>
                      {!passwordErrors.confirmPassword && confirmNewPassword && confirmNewPassword !== newPassword ? (
                        <p className="text-xs text-destructive">两次输入的新密码不一致</p>
                      ) : null}
                    </Field>
                  </FieldGroup>

                  {passwordSubmitError ? (
                    <Alert variant="destructive">
                      <AlertCircle className="size-4" aria-hidden="true" />
                      <AlertTitle>{passwordSubmitError}</AlertTitle>
                    </Alert>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={passwordPending}
                      onClick={() => setPasswordSectionOpen(false)}
                    >
                      收起
                    </Button>
                    <Button type="submit" size="sm" disabled={passwordPending}>
                      {passwordPending ? (
                        <Spinner className="size-4" aria-hidden="true" role="presentation" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                      {passwordPending ? '更新中…' : '更新密码'}
                    </Button>
                  </div>
                </form>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={switchConfirmOpen}
        onOpenChange={setSwitchConfirmOpen}
        title="放弃当前未保存的修改？"
        description={`你对「${baby?.nickname ?? ''}」的修改尚未保存，切换至「${pendingSwitchBaby?.nickname ?? ''}」后将丢失这些修改。`}
        confirmLabel="放弃并切换"
        destructive={false}
        onConfirm={() => {
          if (pendingSwitchBaby) {
            selectBaby(pendingSwitchBaby.id);
          }
          setSwitchConfirmOpen(false);
        }}
      />

      <AddBabyDialog open={addBabyOpen} onOpenChange={setAddBabyOpen} currentCount={babies.length} />

      {/* 硬删除宝宝档案：要求准确输入宝宝昵称后方可确认 */}
      <Dialog open={deleteDialogOpen} pending={deleteBaby.isPending} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>永久删除「{deleteTarget?.nickname ?? ''}」？</DialogTitle>
            <DialogDescription>
              此操作将永久删除该宝宝的档案以及全部喂养、睡眠、护理、健康、生长与疫苗接种记录，无法撤回。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmDeleteBaby} noValidate className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="delete-baby-confirm-input">
                请输入宝宝昵称 <span className="font-semibold text-foreground">{deleteTarget?.nickname ?? ''}</span>{' '}
                以确认删除
              </FieldLabel>
              <Input
                id="delete-baby-confirm-input"
                value={deleteConfirmInput}
                disabled={deleteBaby.isPending}
                placeholder={deleteTarget?.nickname ?? ''}
                autoComplete="off"
                onChange={(event) => {
                  setDeleteConfirmInput(event.target.value);
                  setDeleteError('');
                }}
              />
            </Field>

            {deleteError ? (
              <Alert variant="destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertTitle>{deleteError}</AlertTitle>
              </Alert>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteBaby.isPending}
                onClick={() => setDeleteDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={deleteBaby.isPending || !deleteTarget || deleteConfirmInput !== deleteTarget.nickname}
              >
                {deleteBaby.isPending ? (
                  <Spinner className="size-4" aria-hidden="true" role="presentation" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {deleteBaby.isPending ? '正在删除…' : '永久删除'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认退出登录？"
        description="退出后下次访问需要重新输入账号和密码。"
        confirmLabel={pending ? '正在退出…' : '确认退出'}
        pending={pending}
        onConfirm={confirmLogout}
      />
    </div>
  );
}
