import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, LogOutIcon, MonitorIcon, MoonIcon, ShieldCheck, SunIcon } from 'lucide-react';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { useLogoutAction } from '@/hooks/use-logout';
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

function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);
  const { confirmOpen, setConfirmOpen, pending, confirmLogout } = useLogoutAction();

  const username = user?.username ?? 'admin';

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">偏好与账号</h1>
        <p className="text-sm text-muted-foreground">调整显示外观与管理当前账号登录状态。</p>
      </div>

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
