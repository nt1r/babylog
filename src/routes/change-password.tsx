import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { AlertCircle, Eye, EyeOff, KeyRound, LockKeyhole, LogOutIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ThemeSwitcher } from '@/components/app-shell/theme-switcher';
import { BrandMark } from '@/components/brand/brand-mark';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { PasswordLengthHint } from '@/components/password-length-hint';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useLogoutAction } from '@/hooks/use-logout';
import {
  type ChangePasswordValidationErrors,
  changePassword,
  PASSWORD_MIN_LENGTH,
  validateChangePasswordForm,
} from '@/lib/auth';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/change-password')({
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);
  const setUser = useAuthStore((state) => state.setUser);
  const { confirmOpen, setConfirmOpen, pending: logoutPending, confirmLogout } = useLogoutAction();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ChangePasswordValidationErrors>({});

  useEffect(() => {
    document.title = '修改初始密码 · BabyLog';
  }, []);

  if (restoring) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.must_change_password) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validateChangePasswordForm({
      currentPassword,
      newPassword,
      confirmPassword,
      currentEmptyMessage: '请输入当前临时密码',
      rejectSameAsCurrent: true,
    });
    if (nextErrors.currentPassword || nextErrors.newPassword || nextErrors.confirmPassword) {
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);
    setSubmitError('');
    setFieldErrors({});
    try {
      const updatedUser = await changePassword(currentPassword, newPassword);
      setUser(updatedUser);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('密码已更新', '欢迎进入 BabyLog。');
      await navigate({ to: '/dashboard', replace: true });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '修改密码失败，请稍后重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-[1360px] flex-col px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-10 md:px-16 md:pt-9">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-primary">
          <BrandMark className="size-9" />
          <span className="text-xl leading-none font-bold tracking-tight text-foreground">
            Baby<span className="font-medium">Log</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <ThemeSwitcher showTooltip={false} />
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            <LogOutIcon className="size-4" />
            退出登录
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center py-8">
        <Card className="gap-0 rounded-card border-border/75 p-6 shadow-card sm:p-8">
          <CardHeader className="mb-6 gap-2 p-0">
            <div className="flex items-center gap-2.5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <KeyRound className="size-5" strokeWidth={1.8} />
              </span>
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">请先修改初始密码</h1>
                <p className="text-xs text-muted-foreground">当前账号：{user.username}</p>
              </div>
            </div>
            <CardDescription className="leading-relaxed">
              为保护宝宝和家人的隐私，请先设置一个不少于 {PASSWORD_MIN_LENGTH} 位的个人密码再继续使用。
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5" aria-label="修改初始密码">
              <FieldGroup className="gap-4">
                <Field invalid={Boolean(fieldErrors.currentPassword)}>
                  <FieldLabel htmlFor="force-current-password">当前密码</FieldLabel>
                  <InputGroup className="h-11">
                    <InputGroupAddon align="inline-start">
                      <LockKeyhole className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="force-current-password"
                      name="current-password"
                      type={showCurrent ? 'text' : 'password'}
                      value={currentPassword}
                      disabled={pending}
                      aria-invalid={Boolean(fieldErrors.currentPassword)}
                      placeholder="请输入当前临时密码"
                      autoComplete="current-password"
                      onChange={(event) => {
                        setCurrentPassword(event.target.value);
                        setSubmitError('');
                        if (fieldErrors.currentPassword) {
                          setFieldErrors((prev) => ({ ...prev, currentPassword: undefined }));
                        }
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
                        aria-label={showCurrent ? '隐藏当前密码' : '显示当前密码'}
                        aria-pressed={showCurrent}
                        onClick={() => setShowCurrent((v) => !v)}
                      >
                        {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError>{fieldErrors.currentPassword}</FieldError>
                </Field>

                <Field invalid={Boolean(fieldErrors.newPassword)}>
                  <FieldLabel htmlFor="force-new-password">新密码（至少 {PASSWORD_MIN_LENGTH} 位）</FieldLabel>
                  <InputGroup className="h-11">
                    <InputGroupAddon align="inline-start">
                      <KeyRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="force-new-password"
                      name="new-password"
                      type={showNew ? 'text' : 'password'}
                      value={newPassword}
                      disabled={pending}
                      aria-invalid={Boolean(fieldErrors.newPassword)}
                      placeholder="请输入至少 12 位新密码"
                      autoComplete="new-password"
                      onChange={(event) => {
                        setNewPassword(event.target.value);
                        setSubmitError('');
                        if (fieldErrors.newPassword) {
                          setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
                        }
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
                        aria-label={showNew ? '隐藏新密码' : '显示新密码'}
                        aria-pressed={showNew}
                        onClick={() => setShowNew((v) => !v)}
                      >
                        {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError>{fieldErrors.newPassword}</FieldError>
                  {!fieldErrors.newPassword ? <PasswordLengthHint value={newPassword} /> : null}
                </Field>

                <Field invalid={Boolean(fieldErrors.confirmPassword)}>
                  <FieldLabel htmlFor="force-confirm-password">确认新密码</FieldLabel>
                  <InputGroup className="h-11">
                    <InputGroupAddon align="inline-start">
                      <KeyRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="force-confirm-password"
                      name="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      disabled={pending}
                      aria-invalid={Boolean(fieldErrors.confirmPassword)}
                      placeholder="请再次输入新密码"
                      autoComplete="new-password"
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        setSubmitError('');
                        if (fieldErrors.confirmPassword) {
                          setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                        }
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
                        aria-label={showConfirm ? '隐藏确认密码' : '显示确认密码'}
                        aria-pressed={showConfirm}
                        onClick={() => setShowConfirm((v) => !v)}
                      >
                        {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError>{fieldErrors.confirmPassword}</FieldError>
                  {!fieldErrors.confirmPassword && confirmPassword && confirmPassword !== newPassword ? (
                    <p className="text-xs text-destructive">两次输入的新密码不一致</p>
                  ) : null}
                </Field>
              </FieldGroup>

              {submitError ? (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>{submitError}</AlertTitle>
                </Alert>
              ) : null}

              <Button type="submit" size="lg" disabled={pending} className="h-12 w-full rounded-xl">
                {pending ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
                {pending ? '正在保存…' : '保存新密码并进入'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认退出登录？"
        description="退出后下次访问需要重新输入账号和密码。"
        confirmLabel={logoutPending ? '正在退出…' : '确认退出'}
        pending={logoutPending}
        onConfirm={confirmLogout}
      />
    </div>
  );
}
