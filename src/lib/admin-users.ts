import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserRole } from '@/lib/auth';
import { apiRequest } from '@/lib/http';
import { ADMIN_USERS_QUERY_KEY } from '@/lib/query-client';

export interface AdminUserSummary {
  id: number;
  username: string;
  role: UserRole;
  disabled: boolean;
  must_change_password: boolean;
  created_at: string;
}

interface AdminUsersListResponse {
  users: AdminUserSummary[];
}

interface AdminUserSingleResponse {
  user: AdminUserSummary;
}

const TEMP_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';

/** 使用浏览器密码学随机源生成易读且高强度的临时密码（默认 16 位，不含易混淆字符）。 */
export function generateTemporaryPassword(length = 16): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += TEMP_PASSWORD_CHARSET[bytes[i] % TEMP_PASSWORD_CHARSET.length];
  }
  return out;
}

async function fetchAdminUsers(signal?: AbortSignal): Promise<AdminUserSummary[]> {
  const res = await apiRequest<AdminUsersListResponse>('/api/admin/users', { signal });
  return Array.isArray(res.users) ? res.users : [];
}

/** 查询全部用户账号元数据（仅管理员可用，响应不含任何宝宝或育儿记录统计）。 */
export function useAdminUsersQuery(enabled = true) {
  return useQuery({
    queryKey: ADMIN_USERS_QUERY_KEY,
    queryFn: ({ signal }) => fetchAdminUsers(signal),
    enabled,
  });
}

/** 管理员创建普通用户（服务端自动置位 must_change_password = true）。 */
export function useCreateAdminUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly username: string; readonly password: string }) => {
      const res = await apiRequest<AdminUserSingleResponse>('/api/admin/users', {
        method: 'POST',
        body: input,
      });
      return res.user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY });
    },
  });
}

/** 管理员切换普通用户的停用/启用状态，停用时服务端即时吊销目标用户的全部活跃会话。 */
export function useSetAdminUserDisabledMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly id: number; readonly disabled: boolean }) => {
      const res = await apiRequest<AdminUserSingleResponse>(`/api/admin/users/${input.id}`, {
        method: 'PATCH',
        body: { disabled: input.disabled },
      });
      return res.user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY });
    },
  });
}

/** 管理员为普通用户重置临时密码，服务端置位待改密并吊销其全部活跃会话。 */
export function useResetAdminUserPasswordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly id: number; readonly password: string }) => {
      const res = await apiRequest<AdminUserSingleResponse>(`/api/admin/users/${input.id}/reset-password`, {
        method: 'POST',
        body: { password: input.password },
      });
      return res.user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY });
    },
  });
}
