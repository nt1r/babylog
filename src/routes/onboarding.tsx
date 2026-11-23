import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import { AlertCircle, Baby, ChevronDown, ChevronUp } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ThemeSwitcher } from '@/components/app-shell/theme-switcher';
import { BrandMark } from '@/components/brand/brand-mark';
import { LittleMoments } from '@/components/brand/little-moments';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import {
  BABY_GENDER_LABELS,
  type BabyFormValidationErrors,
  type BabyGender,
  useBabyProfileQuery,
  useCreateBabyMutation,
  validateBabyProfileForm,
} from '@/lib/baby';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

const GENDER_OPTIONS: ReadonlyArray<{ value: BabyGender; label: string; hint: string }> = [
  { value: 'male', label: BABY_GENDER_LABELS.male, hint: '小王子' },
  { value: 'female', label: BABY_GENDER_LABELS.female, hint: '小公主' },
  { value: 'unknown', label: BABY_GENDER_LABELS.unknown, hint: '稍后再说' },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);

  const babyQuery = useBabyProfileQuery(Boolean(user) && !restoring);
  const createBaby = useCreateBabyMutation();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState(todayStr);
  const [gender, setGender] = useState<BabyGender>('unknown');
  const [showOptional, setShowOptional] = useState(false);
  const [birthWeight, setBirthWeight] = useState('');
  const [birthHeight, setBirthHeight] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<BabyFormValidationErrors>({});

  useEffect(() => {
    document.title = '创建宝宝档案 · BabyLog';
  }, []);

  if (restoring || (user && babyQuery.isLoading)) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" search={{ redirect: '/onboarding' }} replace />;
  }

  if (babyQuery.data) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBaby.isPending) return;

    const { payload, errors } = validateBabyProfileForm({
      nickname,
      birthDate,
      gender,
      birthWeight,
      birthHeight,
      todayStr,
    });
    if (!payload) {
      if (errors.birthWeight || errors.birthHeight) {
        setShowOptional(true);
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitError('');
    setFieldErrors({});
    try {
      const created = await createBaby.mutateAsync(payload);
      toast.success(`欢迎 ${created.nickname}`, '宝宝档案已创建，开始记录成长日常吧。');
      await navigate({ to: '/dashboard', replace: true });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '创建档案失败，请稍后重试。');
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-[1360px] flex-col px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-10 md:px-16 md:pt-9">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-primary">
          <BrandMark className="size-9" />
          <span className="text-xl leading-none font-bold tracking-tight text-foreground">
            Baby<span className="font-medium">Log</span>
          </span>
        </div>
        <ThemeSwitcher showTooltip={false} />
      </header>

      <main className="mx-auto grid w-full max-w-[1040px] flex-1 grid-cols-1 items-center gap-10 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:gap-14">
        <section className="hidden flex-col gap-4 md:flex">
          <h2 className="text-[clamp(30px,3vw,42px)] leading-[1.35] font-semibold tracking-tight">
            为宝宝建立
            <br />
            <span className="text-primary">专属成长档案。</span>
          </h2>
          <p className="text-[15px] leading-[1.75] text-muted-foreground">
            填写小名与出生日期后，看板会自动计算宝宝月龄与天数，陪你记录每一天的变化。
          </p>
          <LittleMoments className="mt-2 max-w-80" />
        </section>

        <Card className="mx-auto w-full max-w-[460px] gap-0 rounded-card border-border/75 p-6 shadow-card sm:p-8">
          <CardHeader className="mb-6 gap-2 p-0">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Baby className="size-5" strokeWidth={1.8} />
              </span>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">创建宝宝档案</h1>
            </div>
            <CardDescription>填写宝宝的基本信息即可开始记录，后续随时可在设置中修改。</CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              <FieldGroup className="gap-4">
                <Field invalid={Boolean(fieldErrors.nickname)}>
                  <FieldLabel htmlFor="baby-nickname">宝宝昵称 / 小名</FieldLabel>
                  <Input
                    id="baby-nickname"
                    value={nickname}
                    maxLength={32}
                    placeholder="例如：小汤圆、团子"
                    aria-invalid={Boolean(fieldErrors.nickname)}
                    onChange={(event) => {
                      setNickname(event.target.value);
                      if (fieldErrors.nickname) setFieldErrors((prev) => ({ ...prev, nickname: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.nickname}</FieldError>
                </Field>

                <Field invalid={Boolean(fieldErrors.birthDate)}>
                  <FieldLabel htmlFor="baby-birth-date">出生日期</FieldLabel>
                  <Input
                    id="baby-birth-date"
                    type="date"
                    max={todayStr}
                    value={birthDate}
                    className="tabular-nums"
                    aria-invalid={Boolean(fieldErrors.birthDate)}
                    onChange={(event) => {
                      setBirthDate(event.target.value);
                      if (fieldErrors.birthDate) setFieldErrors((prev) => ({ ...prev, birthDate: undefined }));
                    }}
                  />
                  <FieldError>{fieldErrors.birthDate}</FieldError>
                </Field>

                <div className="space-y-2">
                  <p className="text-[13px] font-medium text-foreground">宝宝性别</p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {GENDER_OPTIONS.map((option) => {
                      const active = gender === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setGender(option.value)}
                          className={cn(
                            'flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2.5 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active
                              ? 'border-primary bg-accent text-accent-foreground'
                              : 'border-border/80 bg-background/50 text-foreground hover:bg-muted/60',
                          )}
                        >
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowOptional((v) => !v)}
                    className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {showOptional ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    补充出生体重与身高（可选）
                  </button>

                  {showOptional ? (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field invalid={Boolean(fieldErrors.birthWeight)}>
                        <FieldLabel htmlFor="baby-birth-weight">出生体重（kg）</FieldLabel>
                        <Input
                          id="baby-birth-weight"
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
                            setBirthWeight(event.target.value);
                            if (fieldErrors.birthWeight) {
                              setFieldErrors((prev) => ({ ...prev, birthWeight: undefined }));
                            }
                          }}
                        />
                        <FieldError>{fieldErrors.birthWeight}</FieldError>
                      </Field>
                      <Field invalid={Boolean(fieldErrors.birthHeight)}>
                        <FieldLabel htmlFor="baby-birth-height">出生身高（cm）</FieldLabel>
                        <Input
                          id="baby-birth-height"
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
                            setBirthHeight(event.target.value);
                            if (fieldErrors.birthHeight) {
                              setFieldErrors((prev) => ({ ...prev, birthHeight: undefined }));
                            }
                          }}
                        />
                        <FieldError>{fieldErrors.birthHeight}</FieldError>
                      </Field>
                    </div>
                  ) : null}
                </div>
              </FieldGroup>

              {submitError ? (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>{submitError}</AlertTitle>
                </Alert>
              ) : null}

              <Button type="submit" size="lg" disabled={createBaby.isPending} className="h-12 w-full rounded-xl">
                {createBaby.isPending ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
                {createBaby.isPending ? '正在创建…' : '开启成长记录'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
