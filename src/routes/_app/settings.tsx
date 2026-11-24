import { createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import {
  Baby,
  CheckIcon,
  DownloadIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SaveIcon,
  ShareIcon,
  SmartphoneIcon,
  SunIcon,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QuickChip } from '@/components/ui/choice-controls';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useLogoutAction } from '@/hooks/use-logout';
import {
  BABY_GENDER_LABELS,
  type BabyFormValidationErrors,
  type BabyGender,
  useBabyProfileQuery,
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
  const user = useAuthStore((state) => state.user);
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);
  const { confirmOpen, setConfirmOpen, pending, confirmLogout } = useLogoutAction();

  const babyQuery = useBabyProfileQuery();
  const updateBaby = useUpdateBabyMutation();
  const baby = babyQuery.data;
  const { standalone, canPromptInstall, isIOS } = usePwaInstallState();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<BabyGender>('unknown');
  const [birthWeight, setBirthWeight] = useState('');
  const [birthHeight, setBirthHeight] = useState('');
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<BabyFormValidationErrors>({});

  // 仅在尚未本地编辑时同步服务端档案，避免窗口切回触发 refetch 冲掉未保存修改。
  useEffect(() => {
    if (!baby || dirty) return;
    setNickname(baby.nickname);
    setBirthDate(baby.birth_date);
    setGender(baby.gender);
    setBirthWeight(baby.birth_weight_kg !== null ? String(baby.birth_weight_kg) : '');
    setBirthHeight(baby.birth_height_cm !== null ? String(baby.birth_height_cm) : '');
  }, [baby, dirty]);

  async function handleSaveBaby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (updateBaby.isPending) return;

    const { payload, errors } = validateBabyProfileForm({
      nickname,
      birthDate,
      gender,
      birthWeight,
      birthHeight,
      todayStr,
    });
    if (!payload) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    try {
      await updateBaby.mutateAsync(payload);
      setDirty(false);
      toast.success('宝宝档案已更新');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    }
  }

  const username = user?.username ?? '当前账号';
  const ageInfo = baby ? formatBabyAge(baby.birth_date) : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only md:not-sr-only md:text-2xl md:font-semibold md:tracking-tight">偏好与账号</h1>

      {baby ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Baby className="size-4.5" strokeWidth={1.8} />
                </span>
                <CardTitle>宝宝档案</CardTitle>
              </div>
              {ageInfo ? (
                <Badge variant="secondary" className="font-normal">
                  {ageInfo.daysLabel} · {ageInfo.ageLabel}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveBaby} noValidate className="space-y-4">
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field invalid={Boolean(fieldErrors.nickname)}>
                  <FieldLabel htmlFor="settings-baby-name">宝宝昵称</FieldLabel>
                  <Input
                    id="settings-baby-name"
                    value={nickname}
                    maxLength={32}
                    aria-invalid={Boolean(fieldErrors.nickname)}
                    onChange={(event) => {
                      setDirty(true);
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
                    invalid={Boolean(fieldErrors.birthDate)}
                    ariaLabel="出生日期"
                    drawerTitle="宝宝出生日期"
                    onChange={(nextDate) => {
                      setDirty(true);
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
                        onClick={() => {
                          setDirty(true);
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
                    placeholder="如 3.35"
                    className="tabular-nums"
                    aria-invalid={Boolean(fieldErrors.birthWeight)}
                    value={birthWeight}
                    onChange={(event) => {
                      setDirty(true);
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
                    placeholder="如 50.0"
                    className="tabular-nums"
                    aria-invalid={Boolean(fieldErrors.birthHeight)}
                    value={birthHeight}
                    onChange={(event) => {
                      setDirty(true);
                      setBirthHeight(event.target.value);
                      if (fieldErrors.birthHeight) setFieldErrors((prev) => ({ ...prev, birthHeight: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.birthHeight}</FieldError>
                </Field>
              </FieldGroup>

              <div className="flex justify-end">
                <Button type="submit" disabled={updateBaby.isPending}>
                  {updateBaby.isPending ? (
                    <Spinner className="size-4" aria-hidden="true" role="presentation" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  {updateBaby.isPending ? '保存中…' : '保存档案'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

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
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <SmartphoneIcon className="size-4.5" strokeWidth={1.8} />
              </span>
              <div>
                <CardTitle>添加到手机桌面</CardTitle>
                <CardDescription>添加后可直接从桌面全屏打开，日常记录更顺手。</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {canPromptInstall ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-muted/30 p-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  将 BabyLog 添加到桌面，点击图标即可快速记录。
                </p>
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
              </div>
            ) : isIOS ? (
              <div className="space-y-2 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">在 Safari 添加到主屏幕：</p>
                <ol className="list-decimal space-y-1 pl-4">
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
              <p className="rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
                在手机浏览器中选择「分享 → 添加到主屏幕」，或在桌面浏览器地址栏点击安装图标，即可像独立应用一样打开。
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>当前账号</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-10 rounded-2xl bg-primary/15 text-primary">
                <AvatarFallback className="text-sm">{getInitials(username)}</AvatarFallback>
              </Avatar>
              <p className="font-semibold text-foreground">{username}</p>
            </div>

            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              <LogOutIcon className="size-4" />
              退出登录
            </Button>
          </div>
        </CardContent>
      </Card>

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
