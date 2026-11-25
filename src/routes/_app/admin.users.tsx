import { createFileRoute, Navigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import {
  AlertCircle,
  CheckIcon,
  CopyIcon,
  Eye,
  EyeOff,
  KeyRound,
  PlusIcon,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyActions, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import {
  type AdminUserSummary,
  generateTemporaryPassword,
  useAdminUsersQuery,
  useCreateAdminUserMutation,
  useResetAdminUserPasswordMutation,
  useSetAdminUserDisabledMutation,
} from '@/lib/admin-users';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH } from '@/lib/auth';
import { getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/_app/admin/users')({
  component: AdminUsersPage,
});

function formatUserDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return format(date, 'yyyy-MM-dd');
}

function renderStatusBadge(target: AdminUserSummary) {
  if (target.disabled) {
    return (
      <Badge variant="secondary" className="bg-destructive-soft font-normal text-destructive-soft-foreground">
        已停用
      </Badge>
    );
  }
  if (target.must_change_password) {
    return (
      <Badge variant="secondary" className="bg-warning-soft font-normal text-warning-soft-foreground">
        待改密
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-primary/12 font-normal text-primary">
      正常
    </Badge>
  );
}

interface OneTimeCredentialPanelProps {
  readonly title: string;
  readonly username: string;
  readonly password: string;
  readonly note: string;
  readonly onClose: () => void;
}

function OneTimeCredentialPanel({ title, username, password, note, onClose }: OneTimeCredentialPanelProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const loginUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const text = loginUrl
      ? `登录地址：${loginUrl}\n账号：${username}\n临时密码：${password}`
      : `账号：${username}\n临时密码：${password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(loginUrl ? '已复制登录地址、账号与临时密码' : '已复制账号与临时密码');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('无法自动复制', '请手动选中上方密码进行复制。');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-warning/40 bg-warning-soft/50 p-3.5 text-xs leading-relaxed text-warning-soft-foreground">
        <p className="font-semibold">{title}</p>
        <p className="mt-1">{note}</p>
      </div>

      <div className="space-y-2.5 rounded-xl border border-border/80 bg-muted/35 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">登录账号</span>
          <span className="font-mono font-semibold text-foreground">{username}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">临时密码</span>
          <span className="font-mono font-semibold break-all text-foreground select-all">{password}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => void handleCopy()}>
          {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          {copied ? '已复制' : '复制登录信息'}
        </Button>
        <Button type="button" onClick={onClose}>
          我已保存
        </Button>
      </div>
    </div>
  );
}

interface TemporaryPasswordFieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly error?: string;
  readonly onChange: (nextValue: string) => void;
  readonly onRegenerate: () => void;
  readonly onToggleVisible: () => void;
}

function TemporaryPasswordField({
  id,
  label,
  placeholder,
  value,
  visible,
  disabled,
  error,
  onChange,
  onRegenerate,
  onToggleVisible,
}: TemporaryPasswordFieldProps) {
  return (
    <Field invalid={Boolean(error)}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={onRegenerate}>
          <RefreshCw className="size-3" />
          随机生成
        </Button>
      </div>
      <InputGroup className="h-10">
        <InputGroupInput
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          placeholder={placeholder}
          className="font-mono"
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={visible ? '隐藏临时密码' : '显示临时密码'}
            aria-pressed={visible}
            onClick={onToggleVisible}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function AdminUsersPage() {
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === 'admin';

  const usersQuery = useAdminUsersQuery(isAdmin);
  const createUser = useCreateAdminUserMutation();
  const setDisabled = useSetAdminUserDisabledMutation();
  const resetPassword = useResetAdminUserPasswordMutation();

  // 创建用户弹窗状态
  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(true);
  const [createError, setCreateError] = useState('');
  const [createFieldErrors, setCreateFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [createdCredential, setCreatedCredential] = useState<{ username: string; password: string } | null>(null);

  // 重置密码弹窗：独立维护 open 与目标快照，避免关闭动画期间标题闪空。
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUserSummary | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(true);
  const [resetError, setResetError] = useState('');
  const [resetFieldError, setResetFieldError] = useState('');
  const [resetCredential, setResetCredential] = useState<{ username: string; password: string } | null>(null);

  // 启停用确认弹窗：独立维护 open 与目标快照，防止退出动画期间文案闪烁。
  const [toggleOpen, setToggleOpen] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<AdminUserSummary | null>(null);

  useEffect(() => {
    if (!createOpen) return;
    setCreateUsername('');
    setCreatePassword(generateTemporaryPassword());
    setShowCreatePassword(true);
    setCreateError('');
    setCreateFieldErrors({});
    setCreatedCredential(null);
  }, [createOpen]);

  function openResetDialog(target: AdminUserSummary) {
    setResetTarget(target);
    setResetNewPassword(generateTemporaryPassword());
    setShowResetPassword(true);
    setResetError('');
    setResetFieldError('');
    setResetCredential(null);
    setResetOpen(true);
  }

  function openToggleDialog(target: AdminUserSummary) {
    setToggleTarget(target);
    setToggleOpen(true);
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createUser.isPending) return;

    const errors: { username?: string; password?: string } = {};
    const trimmedUsername = createUsername.trim();
    if (!trimmedUsername) {
      errors.username = '请输入用户名';
    } else if (createUsername !== trimmedUsername) {
      errors.username = '用户名开头和结尾不能有空格';
    } else if (Array.from(trimmedUsername).length > USERNAME_MAX_LENGTH) {
      errors.username = `用户名最多 ${USERNAME_MAX_LENGTH} 个字`;
    }

    const passLen = Array.from(createPassword).length;
    if (!createPassword) {
      errors.password = '请输入初始密码';
    } else if (passLen < PASSWORD_MIN_LENGTH || passLen > PASSWORD_MAX_LENGTH) {
      errors.password = `初始密码长度须为 ${PASSWORD_MIN_LENGTH} 至 ${PASSWORD_MAX_LENGTH} 位`;
    }

    if (errors.username || errors.password) {
      setCreateFieldErrors(errors);
      return;
    }

    setCreateError('');
    setCreateFieldErrors({});
    try {
      const created = await createUser.mutateAsync({
        username: trimmedUsername,
        password: createPassword,
      });
      toast.success(`已创建用户 ${created.username}`);
      setCreatedCredential({ username: created.username, password: createPassword });
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : '创建用户失败，请稍后重试。');
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget || resetPassword.isPending) return;

    const passLen = Array.from(resetNewPassword).length;
    if (!resetNewPassword) {
      setResetFieldError('请输入新的临时密码');
      return;
    }
    if (passLen < PASSWORD_MIN_LENGTH || passLen > PASSWORD_MAX_LENGTH) {
      setResetFieldError(`临时密码长度须为 ${PASSWORD_MIN_LENGTH} 至 ${PASSWORD_MAX_LENGTH} 位`);
      return;
    }

    setResetError('');
    setResetFieldError('');
    try {
      const updated = await resetPassword.mutateAsync({
        id: resetTarget.id,
        password: resetNewPassword,
      });
      toast.success(`已重置 ${updated.username} 的密码`);
      setResetCredential({ username: updated.username, password: resetNewPassword });
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : '重置密码失败，请稍后重试。');
    }
  }

  async function handleConfirmToggle() {
    if (!toggleTarget || setDisabled.isPending) return;
    const nextDisabled = !toggleTarget.disabled;
    try {
      const updated = await setDisabled.mutateAsync({
        id: toggleTarget.id,
        disabled: nextDisabled,
      });
      toast.success(nextDisabled ? `已停用 ${updated.username}` : `已重新启用 ${updated.username}`);
      setToggleOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '操作失败，请稍后重试。');
    }
  }

  const users = usersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">用户管理</h1>
          <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
            管理家庭账号；为保护隐私，管理员无法查看其他账号的宝宝档案和记录。
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="size-4" />
          创建用户
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Users className="size-4.5" strokeWidth={1.8} />
              </span>
              <div>
                <CardTitle>账号列表</CardTitle>
                <CardDescription>共 {users.length} 个账号</CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {usersQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          ) : usersQuery.isError ? (
            <Empty className="border-dashed py-8">
              <EmptyMedia>
                <span className="flex size-10 items-center justify-center rounded-2xl bg-destructive-soft text-destructive-soft-foreground">
                  <AlertCircle className="size-5" />
                </span>
              </EmptyMedia>
              <EmptyTitle>用户列表加载失败</EmptyTitle>
              <EmptyDescription>
                {usersQuery.error instanceof Error ? usersQuery.error.message : '请检查网络连接后重试。'}
              </EmptyDescription>
              <EmptyActions>
                <Button variant="outline" onClick={() => void usersQuery.refetch()}>
                  <RotateCw className="size-4" />
                  重新加载
                </Button>
              </EmptyActions>
            </Empty>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-border/75 rounded-2xl border border-border/80">
                {users.map((item) => {
                  const isItemAdmin = item.role === 'admin';
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-10 shrink-0 rounded-xl bg-primary/12 text-primary">
                          <AvatarFallback className="rounded-xl text-sm">{getInitials(item.username)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-semibold text-foreground">{item.username}</span>
                            {isItemAdmin ? (
                              <Badge variant="default" className="gap-1 font-normal">
                                <ShieldCheck className="size-3" />
                                管理员
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="font-normal">
                                家庭成员
                              </Badge>
                            )}
                            {renderStatusBadge(item)}
                          </div>
                          <p className="text-xs text-muted-foreground">创建于 {formatUserDate(item.created_at)}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {isItemAdmin ? (
                          <span className="text-xs text-muted-foreground">当前管理员账号</span>
                        ) : (
                          <>
                            <Button type="button" variant="outline" size="sm" onClick={() => openResetDialog(item)}>
                              <KeyRound className="size-3.5" />
                              重置密码
                            </Button>
                            <Button
                              type="button"
                              variant={item.disabled ? 'outline' : 'ghost'}
                              size="sm"
                              className={
                                item.disabled
                                  ? undefined
                                  : 'text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground'
                              }
                              onClick={() => openToggleDialog(item)}
                            >
                              {item.disabled ? <UserCheck className="size-3.5" /> : <UserX className="size-3.5" />}
                              {item.disabled ? '启用' : '停用'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {users.length <= 1 ? (
                <p className="text-center text-xs text-muted-foreground">
                  点击右上角「创建用户」即可为家人开通独立账号。
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建用户弹窗：展示一次性临时密码时禁用遮罩误关，须主动点击「我已保存」或关闭按钮 */}
      <Dialog
        open={createOpen}
        pending={createUser.isPending}
        disablePointerDismissal={Boolean(createdCredential)}
        onOpenChange={setCreateOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{createdCredential ? '账号已创建' : '创建家庭账号'}</DialogTitle>
            <DialogDescription>
              {createdCredential
                ? '请立即复制并交给对方，关闭后将无法再次查看此密码。'
                : '对方首次登录时需要修改为自己的密码。'}
            </DialogDescription>
          </DialogHeader>

          {createdCredential ? (
            <OneTimeCredentialPanel
              title="临时密码仅展示这一次"
              username={createdCredential.username}
              password={createdCredential.password}
              note="对方使用该账号登录后，需要先设置个人密码才能开始使用。"
              onClose={() => setCreateOpen(false)}
            />
          ) : (
            <form onSubmit={handleCreateSubmit} noValidate className="flex flex-col gap-4">
              <FieldGroup className="gap-3.5">
                <Field invalid={Boolean(createFieldErrors.username)}>
                  <FieldLabel htmlFor="admin-create-username">用户名</FieldLabel>
                  <Input
                    id="admin-create-username"
                    value={createUsername}
                    maxLength={USERNAME_MAX_LENGTH}
                    disabled={createUser.isPending}
                    placeholder="如 妈妈、alice"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={Boolean(createFieldErrors.username)}
                    onChange={(event) => {
                      setCreateUsername(event.target.value);
                      setCreateError('');
                      if (createFieldErrors.username) {
                        setCreateFieldErrors((prev) => ({ ...prev, username: undefined }));
                      }
                    }}
                  />
                  <FieldError>{createFieldErrors.username}</FieldError>
                </Field>

                <TemporaryPasswordField
                  id="admin-create-password"
                  label={`初始临时密码（至少 ${PASSWORD_MIN_LENGTH} 位）`}
                  placeholder="请输入不少于 12 位的初始密码"
                  value={createPassword}
                  visible={showCreatePassword}
                  disabled={createUser.isPending}
                  error={createFieldErrors.password}
                  onChange={(nextValue) => {
                    setCreatePassword(nextValue);
                    setCreateError('');
                    if (createFieldErrors.password) {
                      setCreateFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  onRegenerate={() => {
                    setCreatePassword(generateTemporaryPassword());
                    setCreateFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  onToggleVisible={() => setShowCreatePassword((v) => !v)}
                />
              </FieldGroup>

              {createError ? (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>{createError}</AlertTitle>
                </Alert>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={createUser.isPending}
                  onClick={() => setCreateOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending ? (
                    <Spinner className="size-4" aria-hidden="true" role="presentation" />
                  ) : (
                    <PlusIcon className="size-4" />
                  )}
                  {createUser.isPending ? '创建中…' : '创建账号'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 重置密码弹窗：展示一次性临时密码时禁用遮罩误关 */}
      <Dialog
        open={resetOpen}
        pending={resetPassword.isPending}
        disablePointerDismissal={Boolean(resetCredential)}
        onOpenChange={setResetOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {resetCredential ? '临时密码已重置' : `重置 ${resetTarget?.username ?? ''} 的密码`}
            </DialogTitle>
            <DialogDescription>
              {resetCredential
                ? '该账号在其他设备上的登录已退出，请将新密码交给对方。'
                : '重置后对方在所有设备上的登录都会退出，下次登录需先修改密码。'}
            </DialogDescription>
          </DialogHeader>

          {resetCredential ? (
            <OneTimeCredentialPanel
              title="新临时密码仅展示这一次"
              username={resetCredential.username}
              password={resetCredential.password}
              note="关闭后将无法再次查看此密码，如忘记可重新重置。"
              onClose={() => setResetOpen(false)}
            />
          ) : (
            <form onSubmit={handleResetSubmit} noValidate className="flex flex-col gap-4">
              <TemporaryPasswordField
                id="admin-reset-password"
                label={`新临时密码（至少 ${PASSWORD_MIN_LENGTH} 位）`}
                placeholder="请输入不少于 12 位的新临时密码"
                value={resetNewPassword}
                visible={showResetPassword}
                disabled={resetPassword.isPending}
                error={resetFieldError}
                onChange={(nextValue) => {
                  setResetNewPassword(nextValue);
                  setResetError('');
                  setResetFieldError('');
                }}
                onRegenerate={() => {
                  setResetNewPassword(generateTemporaryPassword());
                  setResetFieldError('');
                }}
                onToggleVisible={() => setShowResetPassword((v) => !v)}
              />

              {resetError ? (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>{resetError}</AlertTitle>
                </Alert>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={resetPassword.isPending}
                  onClick={() => setResetOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={resetPassword.isPending}>
                  {resetPassword.isPending ? (
                    <Spinner className="size-4" aria-hidden="true" role="presentation" />
                  ) : (
                    <KeyRound className="size-4" />
                  )}
                  {resetPassword.isPending ? '重置中…' : '确认重置密码'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 停用 / 启用确认弹窗 */}
      <DeleteConfirmDialog
        open={toggleOpen}
        onOpenChange={(next) => {
          if (!setDisabled.isPending) setToggleOpen(next);
        }}
        title={
          toggleTarget?.disabled
            ? `确认启用「${toggleTarget.username}」？`
            : `确认停用「${toggleTarget?.username ?? ''}」？`
        }
        description={
          toggleTarget?.disabled
            ? '重新启用后，对方可使用原密码正常登录并查看宝宝档案与记录。'
            : '停用后对方将立即退出登录且无法再进入，已有记录会保留，随时可以重新启用。'
        }
        confirmLabel={setDisabled.isPending ? '处理中…' : toggleTarget?.disabled ? '确认启用' : '确认停用'}
        pending={setDisabled.isPending}
        destructive={!toggleTarget?.disabled}
        onConfirm={handleConfirmToggle}
      />
    </div>
  );
}
