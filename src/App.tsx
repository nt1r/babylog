import { Alert, Button, Card, FieldError, Form, InputGroup, Label, Spinner, TextField } from '@heroui/react';
import { Check, Eye, EyeOff, LockKeyhole, LogOut, RotateCw, UserRound } from 'lucide-react';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface User {
  username: string;
  role: 'admin';
}

async function requestSession(path: string, body?: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error('暂时无法连接服务，请稍后重试。');
  }
  let result: { user?: User | null; error?: string } | null = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok) throw new Error(result?.error ?? '操作未完成，请稍后重试。');
  if (!result || !('user' in result)) throw new Error('服务返回异常，请稍后重试。');
  return result.user ?? null;
}

function BrandMark({ className = 'size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="20" fill="currentColor" />
      <path
        className="brand-mane"
        d="M36.5 16C31.2 16 28 19.6 29.2 23.4 26.8 25.2 27.2 28.6 30.2 29.8L35 28.2 38 17Z"
      />
      <path
        className="brand-pony"
        d="M36.5 15.5 39 10.8c.7-1.2 2.4-.8 2.8.6l1 4.4c2 .4 4 1.7 5.4 3.8l2.6 4.2c1.6 2.6 0 6.4-3.4 6.8-2.4.3-4.4-.8-5.9-2.1l-.5 5.4 3.6 13.7-4.8.8-3.2-10.2h-10l-3 10.2-4.8-.8 3.4-12.6c-4.5-.2-8-2.8-9-6.4-.7-2.6 1.3-4.8 4-3.8 2.3.9 4 2.8 6.8 2.8h8.4c1.4-3.8 2.6-8.4 4.1-12.1Z"
      />
      <path className="brand-rocker" d="M13 46.5q19 10 38 0" strokeWidth="3.8" strokeLinecap="round" />
      <circle cx="42.8" cy="21.4" r="1.9" fill="currentColor" />
    </svg>
  );
}

function LittleMoments() {
  return (
    <svg className="little-moments" viewBox="68 32 362 290" fill="none" aria-hidden="true">
      <path
        className="art-meadow"
        d="M99 103C149 28 288 28 365 93c66 56 77 150 18 183-67 37-247 29-294-19-39-39-27-99 10-154Z"
      />
      <ellipse className="art-ground" cx="249" cy="302" rx="166" ry="13" />
      <g className="art-line" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M128 221V92a53 53 0 0 1 106 0" />
        <path d="M184 43v37m50 12v6" />
        <path className="art-sun" d="M193 79a15 15 0 1 1-18-18 15 15 0 0 0 18 18Z" />
        <path className="art-star" d="m234 95 3.8 8.5 9.5 1-7.5 6.5 2 9.5-7.8-4.7-8.2 4.7 1.8-9.5-6.8-6.5 9.4-1Z" />
        <path className="art-wood" d="m173 267-13 34m164-34 13 34" />
        <path className="art-basket" d="M133 206h231l-19 54a30 30 0 0 1-28 20H181a30 30 0 0 1-28-20Z" />
        <path
          className="basket-weave"
          d="m169 230 11 33m15-33 7 34m19-34 2 34m23-34v34m26-34-3 34m28-34-7 34m31-34-11 33"
        />
        <ellipse className="art-blanket" cx="249" cy="206" rx="118" ry="26" />
        <path className="art-mane" d="M318 181c16-6 31 2 29 17-2 11-15 13-24 8" />
        <path d="M326 189c7-1 13 3 13 9" strokeWidth="2" />
        <path className="art-swaddle" d="M214 192c5-48 92-52 109-6l7 24c-36 15-83 18-116 7Z" />
        <path className="swaddle-fold" d="M230 179c22 1 45 14 57 38m-18-41c-7 11-15 19-24 25" />
        <path className="art-mane" d="M224 148c16-2 27 8 25 22 8 4 10 15 3 23-8 6-20 4-26-2Z" />
        <path className="art-pony" d="M174 152c-5-13-4-25 4-29 8-3 14 7 15 19" />
        <path className="art-pony" d="M212 146c5-14 14-24 21-19 7 4 4 16-4 26" />
        <path className="art-ear-inner" d="M179 145c-2-7-2-14 2-16 4-1 7 4 8 11Z" stroke="none" />
        <path className="art-ear-inner" d="M217 143c2-7 8-14 12-11 3 2 1 8-4 13Z" stroke="none" />
        <path
          className="art-pony"
          d="M167 166c2-18 19-30 41-29 22 1 35 16 33 37-2 22-19 35-44 34-12 0-24-2-32-7-10-6-13-17-7-25 2-3 6-6 9-10Z"
        />
        <path
          className="art-muzzle"
          d="M156 179c5-6 18-7 28-2 10 5 13 15 7 23-6 7-20 8-30 3-9-5-11-16-5-24Z"
          stroke="none"
        />
        <path d="M167 166c-3 4-7 7-9 10-6 8-3 19 7 25 8 5 20 7 32 7 25 1 42-12 44-34" fill="none" />
        <path className="art-mane" d="M190 138c6-13 21-14 29-4-6 2-9 7-8 13-7-4-13 0-16 6-5-4-7-9-5-15Z" />
        <path d="M179 166q5 5.5 11 1" />
        <path d="M206 169q5.5 6 11.5 0" />
        <ellipse className="art-blush-soft" cx="174" cy="175" rx="4.5" ry="2.6" stroke="none" />
        <ellipse className="art-blush" cx="218" cy="180" rx="6.5" ry="3.8" stroke="none" />
        <circle className="art-nostril" cx="166" cy="184" r="1.4" stroke="none" />
        <circle className="art-nostril" cx="177" cy="186" r="1.4" stroke="none" />
        <path d="M166 193q6.5 4.5 12.5-.5" strokeWidth="2.4" />
        <path className="art-pony" d="M222 199c9-3 20-1 22 7 1 6-5 10-13 10-9 0-14-4-14-10 0-3 2-5 5-7Z" />
        <path className="art-hoof" d="M233 198c6 0 11 3 11 8 0 5-4 9-10 9-2-5-3-11-1-17Z" />
        <path className="art-rim" d="M132 207q117 49 234-1v12q-116 49-234 0Z" />
        <path className="art-leaf" d="M380 281c-2-22 4-42 19-53 2 22-5 37-19 53Z" />
        <path className="art-leaf" d="M380 290c-18-6-28-19-28-36 19 6 27 19 28 36Z" />
        <path d="M380 302v-31" />
      </g>
      <g className="art-sparkles" strokeWidth="2.5" strokeLinecap="round">
        <path d="M327 83v15m-7-7h14M96 177v12m-6-6h12M358 157v12m-6-6h12" />
        <circle cx="294" cy="64" r="3" fill="currentColor" stroke="none" />
        <circle cx="95" cy="245" r="3" fill="currentColor" stroke="none" />
      </g>
      <g className="art-sleep" strokeLinecap="round" strokeLinejoin="round">
        <path d="M261 135h9l-9 10h9" strokeWidth="2.2" />
        <path d="M277 115h12l-12 13h12" strokeWidth="2.6" />
      </g>
    </svg>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [showRestoreSpinner, setShowRestoreSpinner] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const restoreController = useRef<AbortController | null>(null);

  const restoreSession = useCallback(() => {
    restoreController.current?.abort();
    const controller = new AbortController();
    restoreController.current = controller;

    setRestoring(true);
    setRestoreFailed(false);
    setShowRestoreSpinner(false);
    setError('');

    const spinnerTimer = window.setTimeout(() => {
      if (!controller.signal.aborted) setShowRestoreSpinner(true);
    }, 150);

    fetch('/api/auth/session', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result: { user: User | null } = await response.json();
        setUser(result.user);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRestoreFailed(true);
          setError('暂时无法连接服务，请检查服务状态后重试。');
        }
      })
      .finally(() => {
        window.clearTimeout(spinnerTimer);
        if (!controller.signal.aborted) {
          setRestoring(false);
          setShowRestoreSpinner(false);
        }
      });
  }, []);

  useEffect(() => {
    restoreSession();
    return () => restoreController.current?.abort();
  }, [restoreSession]);

  useEffect(() => {
    document.title = `${user ? '已登录' : '登录'} · BabyLog`;
    if (user) statusHeading.current?.focus();
  }, [user]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || restoring) return;
    setPending(true);
    setError('');
    setRestoreFailed(false);
    try {
      setUser(await requestSession('login', { username, password }));
      setPassword('');
      setShowPassword(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。');
    } finally {
      setPending(false);
    }
  }

  async function handleLogout() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await requestSession('logout');
      setUser(null);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '退出失败，请稍后重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>

      <header className="page-header">
        <div className="brand text-accent">
          <BrandMark />
          <span className="brand-name text-foreground">
            Baby<span className="brand-name-light">Log</span>
          </span>
        </div>
      </header>

      <main id="main-content" className="login-layout">
        <section className="story" aria-labelledby="story-heading">
          <h2 id="story-heading">
            小小的日常，
            <br />
            <span className="text-accent">大大的成长。</span>
          </h2>
          <p className="story-description text-muted">记录喂养、睡眠与健康，留住宝宝成长的每一天。</p>
          <LittleMoments />
        </section>

        <section className="login-panel" aria-label="账号登录">
          <div className="mobile-brand text-accent">
            <BrandMark className="size-12" />
            <span className="brand-name text-foreground">
              Baby<span className="brand-name-light">Log</span>
            </span>
            <p className="mobile-tagline text-muted">记录宝宝成长的每一天</p>
          </div>

          <Card className="login-card">
            {restoring ? (
              <Card.Content className="session-loading" role="status" aria-busy="true">
                {showRestoreSpinner ? (
                  <>
                    <Spinner size="lg" aria-hidden="true" role="presentation" aria-label={undefined} />
                    <p className="text-muted">正在确认登录状态…</p>
                  </>
                ) : null}
              </Card.Content>
            ) : user ? (
              <>
                <Card.Header className="login-card-header">
                  <div className="welcome-icon">
                    <Check aria-hidden="true" />
                  </div>
                  <h1 className="login-title" ref={statusHeading} tabIndex={-1}>
                    欢迎回来，{user.username}
                  </h1>
                  <Card.Description className="login-description">
                    已进入 BabyLog 家庭空间，记录功能持续完善中。
                  </Card.Description>
                </Card.Header>
                <Card.Content className="authenticated-content">
                  <div className="account-summary">
                    <span className="account-avatar">
                      <UserRound aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-semibold">{user.username}</p>
                      <p className="text-sm text-muted">管理员</p>
                    </div>
                  </div>
                  {error && <ErrorMessage message={error} />}
                  <Button fullWidth size="lg" variant="secondary" isPending={pending} onPress={handleLogout}>
                    {pending ? (
                      <Spinner
                        color="current"
                        size="sm"
                        aria-hidden="true"
                        role="presentation"
                        aria-label={undefined}
                      />
                    ) : (
                      <LogOut className="size-4" aria-hidden="true" />
                    )}
                    {pending ? '正在退出…' : '退出登录'}
                  </Button>
                </Card.Content>
              </>
            ) : (
              <>
                <Card.Header className="login-card-header">
                  <h1 className="login-title">欢迎回来</h1>
                  <Card.Description className="login-description">请登录你的 BabyLog 账号</Card.Description>
                </Card.Header>
                <Card.Content>
                  <Form onSubmit={handleLogin} className="login-form" aria-label="账号登录">
                    <TextField
                      fullWidth
                      isRequired
                      name="username"
                      value={username}
                      isDisabled={pending}
                      onChange={(value) => {
                        setUsername(value);
                        setError('');
                      }}
                      validate={(value) => (value.trim() ? null : '请输入账号')}
                    >
                      <Label className="after:content-none">账号</Label>
                      <InputGroup fullWidth className="login-input">
                        <InputGroup.Prefix>
                          <UserRound className="size-4.5 text-muted" aria-hidden="true" />
                        </InputGroup.Prefix>
                        <InputGroup.Input
                          placeholder="请输入账号"
                          autoComplete="username"
                          autoCapitalize="none"
                          enterKeyHint="next"
                          spellCheck={false}
                        />
                      </InputGroup>
                      <FieldError>
                        {({ validationDetails, validationErrors }) =>
                          validationDetails.valueMissing ? '请输入账号' : validationErrors.join(' ')
                        }
                      </FieldError>
                    </TextField>
                    <TextField
                      fullWidth
                      isRequired
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      isDisabled={pending}
                      onChange={(value) => {
                        setPassword(value);
                        setError('');
                      }}
                      validate={(value) => (value ? null : '请输入密码')}
                    >
                      <Label className="after:content-none">密码</Label>
                      <InputGroup fullWidth className="login-input">
                        <InputGroup.Prefix>
                          <LockKeyhole className="size-4.5 text-muted" aria-hidden="true" />
                        </InputGroup.Prefix>
                        <InputGroup.Input
                          placeholder="请输入密码"
                          autoComplete="current-password"
                          enterKeyHint="done"
                        />
                        <InputGroup.Suffix onClick={(event) => event.stopPropagation()}>
                          <Button
                            isIconOnly
                            type="button"
                            variant="ghost"
                            className="password-toggle"
                            isDisabled={pending}
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                            aria-pressed={showPassword}
                            onPress={() => setShowPassword((visible) => !visible)}
                          >
                            {showPassword ? (
                              <EyeOff className="size-4.5" strokeWidth={1.7} aria-hidden="true" />
                            ) : (
                              <Eye className="size-4.5" strokeWidth={1.7} aria-hidden="true" />
                            )}
                          </Button>
                        </InputGroup.Suffix>
                      </InputGroup>
                      <FieldError>
                        {({ validationDetails, validationErrors }) =>
                          validationDetails.valueMissing ? '请输入密码' : validationErrors.join(' ')
                        }
                      </FieldError>
                    </TextField>
                    {error && <ErrorMessage message={error} onRetry={restoreFailed ? restoreSession : undefined} />}
                    <Button fullWidth size="lg" type="submit" isPending={pending} className="login-submit">
                      {pending ? (
                        <Spinner
                          color="current"
                          size="sm"
                          aria-hidden="true"
                          role="presentation"
                          aria-label={undefined}
                        />
                      ) : null}
                      {pending ? '正在登录…' : '登录'}
                    </Button>
                  </Form>
                </Card.Content>
              </>
            )}
          </Card>
        </section>
      </main>

      <footer className="page-footer text-muted">
        <span>BabyLog</span>
      </footer>
    </div>
  );
}

function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert status="danger" role="alert" className="login-error">
      <Alert.Indicator />
      <Alert.Content className="login-error-content">
        <Alert.Title>{message}</Alert.Title>
        {onRetry ? (
          <Button type="button" size="sm" variant="ghost" className="retry-button" onPress={onRetry}>
            <RotateCw className="size-3.5" aria-hidden="true" />
            重试连接
          </Button>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
