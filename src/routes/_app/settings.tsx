import { createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { Baby, CheckIcon, LogOutIcon, MonitorIcon, MoonIcon, SaveIcon, ShieldCheck, SunIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useLogoutAction } from '@/hooks/use-logout';
import { BABY_GENDER_LABELS, type BabyGender, useBabyProfileQuery, useUpdateBabyMutation } from '@/lib/baby';
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
    description: '温暖明亮，适合白天浏览记录。',
    icon: SunIcon,
  },
  {
    value: 'dark',
    label: '深色护眼',
    description: '柔和暗调，夜间喂奶记录不刺眼。',
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

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<BabyGender>('unknown');
  const [birthWeight, setBirthWeight] = useState('');
  const [birthHeight, setBirthHeight] = useState('');
  const [nicknameError, setNicknameError] = useState('');

  useEffect(() => {
    if (!baby) return;
    setNickname(baby.nickname);
    setBirthDate(baby.birth_date);
    setGender(baby.gender);
    setBirthWeight(baby.birth_weight_kg !== null ? String(baby.birth_weight_kg) : '');
    setBirthHeight(baby.birth_height_cm !== null ? String(baby.birth_height_cm) : '');
  }, [baby]);

  async function handleSaveBaby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (updateBaby.isPending) return;

    const trimmed = nickname.trim();
    if (!trimmed) {
      setNicknameError('请填写宝宝昵称');
      return;
    }
    const parsedWeight = birthWeight.trim() ? Number.parseFloat(birthWeight) : null;
    const parsedHeight = birthHeight.trim() ? Number.parseFloat(birthHeight) : null;
    if (
      (parsedWeight !== null && Number.isNaN(parsedWeight)) ||
      (parsedHeight !== null && Number.isNaN(parsedHeight))
    ) {
      toast.error('请输入有效的出生体重或身高');
      return;
    }

    setNicknameError('');
    try {
      await updateBaby.mutateAsync({
        nickname: trimmed,
        birth_date: birthDate,
        gender,
        birth_weight_kg: parsedWeight,
        birth_height_cm: parsedHeight,
      });
      toast.success('宝宝档案已更新');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    }
  }

  const username = user?.username ?? 'admin';
  const ageInfo = baby ? formatBabyAge(baby.birth_date) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">偏好与账号</h1>
        <p className="text-sm text-muted-foreground">管理宝宝档案、显示外观与当前账号登录状态。</p>
      </div>

      {baby ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Baby className="size-4.5" strokeWidth={1.8} />
                </span>
                <div>
                  <CardTitle>宝宝档案</CardTitle>
                  <CardDescription>用于首页月龄计算与全部成长记录归属。</CardDescription>
                </div>
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
                <Field invalid={Boolean(nicknameError)}>
                  <FieldLabel htmlFor="settings-baby-name">宝宝昵称</FieldLabel>
                  <Input
                    id="settings-baby-name"
                    value={nickname}
                    maxLength={32}
                    aria-invalid={Boolean(nicknameError)}
                    onChange={(event) => {
                      setNickname(event.target.value);
                      if (nicknameError) setNicknameError('');
                    }}
                  />
                  <FieldError>{nicknameError}</FieldError>
                </Field>

                <Field>
                  <FieldLabel htmlFor="settings-baby-birth">出生日期</FieldLabel>
                  <Input
                    id="settings-baby-birth"
                    type="date"
                    max={todayStr}
                    value={birthDate}
                    className="tabular-nums"
                    onChange={(event) => setBirthDate(event.target.value)}
                  />
                </Field>

                <div className="space-y-2 sm:col-span-2">
                  <p className="text-[13px] font-medium text-foreground">性别</p>
                  <div className="flex flex-wrap gap-2">
                    {GENDER_OPTIONS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={gender === g}
                        onClick={() => setGender(g)}
                        className={cn(
                          'cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          gender === g
                            ? 'border-primary bg-accent font-medium text-accent-foreground'
                            : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {BABY_GENDER_LABELS[g]}
                      </button>
                    ))}
                  </div>
                </div>

                <Field>
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
                    value={birthWeight}
                    onChange={(event) => setBirthWeight(event.target.value)}
                  />
                </Field>

                <Field>
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
                    value={birthHeight}
                    onChange={(event) => setBirthHeight(event.target.value)}
                  />
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
          <CardDescription>选择适合当前光线的显示风格，夜间照护推荐使用深色护眼模式。</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>当前账号</CardTitle>
          <CardDescription>已登录家庭成长空间，如需切换设备或结束使用可在此退出。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-11 rounded-2xl bg-primary/15 text-primary">
                <AvatarFallback className="text-sm">{getInitials(username)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">{username}</p>
                  <Badge variant="success">
                    <ShieldCheck className="size-3" />
                    管理员
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">登录状态正常</p>
              </div>
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
