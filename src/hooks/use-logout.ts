import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/stores/auth';

/**
 * 统一的退出登录确认状态与执行逻辑，供顶部账号菜单与设置页复用。
 */
export function useLogoutAction() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const confirmLogout = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await logout();
      queryClient.clear();
      setConfirmOpen(false);
      toast.success('已退出登录');
      await navigate({ to: '/login', replace: true });
    } catch (error) {
      toast.error('退出失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setPending(false);
    }
  }, [logout, navigate, pending, queryClient]);

  return {
    confirmOpen,
    setConfirmOpen,
    pending,
    confirmLogout,
  };
}
