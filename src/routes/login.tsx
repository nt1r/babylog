import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AlertCircle, Eye, EyeOff, LockKeyhole, RotateCw, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ThemeSwitcher } from '@/components/app-shell/theme-switcher';
import { BrandMark } from '@/components/brand/brand-mark';
import { LittleMoments } from '@/components/brand/little-moments';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/stores/auth';

/** 校验登录后的回跳地址，仅允许站内相对路径并拒绝协议相对地址及登录页循环。 */
function sanitizeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) {
    return undefined;
  }
  return value;
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: sanitizeRedirectPath(search.redirect),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);
  const restoreFailed = useAuthStore((state) => state.restoreFailed);
  const restoreError = useAuthStore((state) => state.restoreError);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const login = useAuthStore((state) => state.login);

  const [showRestoreSpinner, setShowRestoreSpinner] = useState(false);
  const [pending, setPending] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});

  useEffect(() => {
    document.title = '登录 · BabyLog';
  }, []);

  // 延迟 150ms 再展示会话恢复加载指示器，避免本地快速探测时出现短暂闪烁。
  useEffect(() => {
    if (!restoring) {
      setShowRestoreSpinner(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRestoreSpinner(true), 150);
    return () => window.clearTimeout(timer);
  }, [restoring]);

  useEffect(() => {
    if (!restoring && user) {
      const target = user.must_change_password ? '/change-password' : (redirect ?? '/dashboard');
      void navigate({ to: target, replace: true });
    }
  }, [restoring, user, redirect, navigate]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || restoring) return;

    const nextErrors: { username?: string; password?: string } = {};
    if (!username.trim()) nextErrors.username = '请输入账号';
    if (!password) nextErrors.password = '请输入密码';
    if (nextErrors.username || nextErrors.password) {
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);
    setSubmitError('');
    setFieldErrors({});
    try {
      const loggedInUser = await login(username, password);
      setPassword('');
      setShowPassword(false);
      const target = loggedInUser?.must_change_password ? '/change-password' : (redirect ?? '/dashboard');
      await navigate({ to: target, replace: true });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。');
    } finally {
      setPending(false);
    }
  }

  const displayError = submitError || (restoreFailed ? restoreError : '');

  return (
    <div className="mx-auto flex min-h-svh max-w-[1360px] flex-col px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-10 md:px-16 md:pt-9 md:pb-7">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        跳至主要内容
      </a>

      <header className="flex items-center justify-between">
        <div className="hidden items-center gap-3 text-primary md:flex">
          <BrandMark className="size-10" />
          <span className="text-2xl leading-none font-bold tracking-tight text-foreground">
            Baby<span className="font-medium">Log</span>
          </span>
        </div>
        <div className="ml-auto">
          <ThemeSwitcher showTooltip={false} />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto grid w-full max-w-[1040px] flex-1 grid-cols-1 items-center gap-10 py-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-12 lg:gap-20 md:py-11"
      >
        <section className="hidden flex-col gap-4 md:flex" aria-labelledby="story-heading">
          <h2 id="story-heading" className="text-[clamp(34px,3.4vw,46px)] leading-[1.35] font-semibold tracking-tight">
            小小的日常，
            <br />
            <span className="text-primary">大大的成长。</span>
          </h2>
          <p className="text-[15px] leading-[1.75] text-muted-foreground">
            记录喂养、睡眠与健康，留住宝宝成长的每一天。
          </p>
          <LittleMoments className="mt-3" />
        </section>

        <section
          className="mx-auto flex w-full max-w-[420px] flex-col gap-6 md:mx-0 md:justify-self-end"
          aria-label="账号登录"
        >
          <div className="flex flex-col items-center gap-2 text-center md:hidden">
            <BrandMark className="size-12 text-primary" />
            <span className="mt-1 text-[26px] leading-none font-bold tracking-tight text-foreground">
              Baby<span className="font-medium">Log</span>
            </span>
            <p className="text-[13px] text-muted-foreground">记录宝宝成长的每一天</p>
          </div>

          <Card className="gap-0 rounded-card border-border/75 p-6 shadow-card sm:p-8 lg:p-10">
            {restoring ? (
              <CardContent
                className="flex min-h-[300px] flex-col items-center justify-center gap-4 p-0 text-[13px]"
                role="status"
                aria-busy="true"
              >
                {showRestoreSpinner ? (
                  <>
                    <Spinner className="size-7 text-primary" aria-hidden="true" role="presentation" />
                    <p className="text-muted-foreground">正在确认登录状态…</p>
                  </>
                ) : null}
              </CardContent>
            ) : (
              <>
                <CardHeader className="mb-7 gap-2 p-0">
                  <h1 className="text-[24px] leading-[1.35] font-semibold tracking-tight sm:text-[26px]">欢迎回来</h1>
                  <CardDescription className="text-[13px] leading-relaxed sm:text-sm">
                    请登录你的 BabyLog 家庭空间账号
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-0">
                  <form onSubmit={handleLogin} noValidate className="flex flex-col gap-5" aria-label="账号登录">
                    <FieldGroup className="gap-5">
                      <Field invalid={Boolean(fieldErrors.username)}>
                        <FieldLabel htmlFor="login-username">账号</FieldLabel>
                        <InputGroup className="h-12">
                          <InputGroupAddon align="inline-start">
                            <UserRound className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
                          </InputGroupAddon>
                          <InputGroupInput
                            id="login-username"
                            name="username"
                            value={username}
                            disabled={pending}
                            aria-invalid={Boolean(fieldErrors.username)}
                            placeholder="请输入账号"
                            autoComplete="username"
                            autoCapitalize="none"
                            enterKeyHint="next"
                            spellCheck={false}
                            onChange={(event) => {
                              setUsername(event.target.value);
                              setSubmitError('');
                              if (fieldErrors.username) {
                                setFieldErrors((prev) => ({ ...prev, username: undefined }));
                              }
                            }}
                          />
                        </InputGroup>
                        <FieldError>{fieldErrors.username}</FieldError>
                      </Field>

                      <Field invalid={Boolean(fieldErrors.password)}>
                        <FieldLabel htmlFor="login-password">密码</FieldLabel>
                        <InputGroup className="h-12">
                          <InputGroupAddon align="inline-start">
                            <LockKeyhole className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
                          </InputGroupAddon>
                          <InputGroupInput
                            id="login-password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            disabled={pending}
                            aria-invalid={Boolean(fieldErrors.password)}
                            placeholder="请输入密码"
                            autoComplete="current-password"
                            enterKeyHint="done"
                            onChange={(event) => {
                              setPassword(event.target.value);
                              setSubmitError('');
                              if (fieldErrors.password) {
                                setFieldErrors((prev) => ({ ...prev, password: undefined }));
                              }
                            }}
                          />
                          <InputGroupAddon align="inline-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              className="size-10 rounded-lg text-muted-foreground hover:text-foreground"
                              aria-label={showPassword ? '隐藏密码' : '显示密码'}
                              aria-pressed={showPassword}
                              onClick={() => setShowPassword((visible) => !visible)}
                            >
                              {showPassword ? (
                                <EyeOff className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
                              ) : (
                                <Eye className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
                              )}
                            </Button>
                          </InputGroupAddon>
                        </InputGroup>
                        <FieldError>{fieldErrors.password}</FieldError>
                      </Field>
                    </FieldGroup>

                    {displayError ? (
                      <Alert variant="destructive">
                        <AlertCircle className="size-4" aria-hidden="true" />
                        <div className="flex flex-col gap-1.5">
                          <AlertTitle>{displayError}</AlertTitle>
                          {restoreFailed && !submitError ? (
                            <div>
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                className="-ml-2 text-destructive-soft-foreground hover:bg-destructive/15"
                                onClick={() => void restoreSession()}
                              >
                                <RotateCw className="size-3.5" aria-hidden="true" />
                                重试连接
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </Alert>
                    ) : null}

                    <Button
                      type="submit"
                      size="lg"
                      disabled={pending}
                      className="mt-1 h-12 w-full rounded-xl text-[15px]"
                    >
                      {pending ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
                      {pending ? '正在登录…' : '登录'}
                    </Button>
                  </form>
                </CardContent>
              </>
            )}
          </Card>
        </section>
      </main>

      <footer className="flex justify-center pt-4 text-xs text-muted-foreground/80">
        <span>BabyLog · 温暖陪伴每一天</span>
      </footer>
    </div>
  );
}
