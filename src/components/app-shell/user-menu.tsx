import { Link } from '@tanstack/react-router';
import { LogOutIcon, Settings2Icon, UsersIcon } from 'lucide-react';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogoutAction } from '@/hooks/use-logout';
import { getInitials } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const { confirmOpen, setConfirmOpen, pending, confirmLogout } = useLogoutAction();

  const username = user?.username ?? '账号';
  const initials = getInitials(username);
  const isAdmin = user?.role === 'admin';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-2 rounded-full pr-2.5 pl-1"
              aria-label={`账号菜单：${username}`}
            />
          }
        >
          <Avatar className="size-7 bg-primary/15 text-primary">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-24 truncate text-sm font-medium sm:inline">{username}</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-52">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar className="size-8 rounded-xl bg-primary/15 text-primary">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{username}</p>
              {isAdmin ? (
                <Badge variant="secondary" className="mt-0.5 text-xs font-normal">
                  管理员
                </Badge>
              ) : null}
            </div>
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link to="/settings" />}>
              <Settings2Icon className="size-4" />
              偏好与账号
            </DropdownMenuItem>
            {isAdmin ? (
              <DropdownMenuItem render={<Link to="/admin/users" />}>
                <UsersIcon className="size-4" />
                用户管理
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            <LogOutIcon className="size-4" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认退出登录？"
        description="退出后下次访问需要重新输入账号和密码。"
        confirmLabel={pending ? '正在退出…' : '确认退出'}
        pending={pending}
        onConfirm={confirmLogout}
      />
    </>
  );
}
