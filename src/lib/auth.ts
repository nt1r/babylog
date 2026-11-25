import { ApiError, apiRequest } from '@/lib/http';

export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  must_change_password: boolean;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;
export const USERNAME_MAX_LENGTH = 128;

export interface ChangePasswordValidationErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/** 统一校验强制改密页与设置页的密码修改表单，保持最小/最大长度与一致性提示统一。 */
export function validateChangePasswordForm(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  currentEmptyMessage: string;
  rejectSameAsCurrent?: boolean;
}): ChangePasswordValidationErrors {
  const errors: ChangePasswordValidationErrors = {};
  if (!input.currentPassword) {
    errors.currentPassword = input.currentEmptyMessage;
  }
  const newLen = Array.from(input.newPassword).length;
  if (!input.newPassword) {
    errors.newPassword = '请输入新密码';
  } else if (newLen < PASSWORD_MIN_LENGTH || newLen > PASSWORD_MAX_LENGTH) {
    errors.newPassword = `新密码长度须为 ${PASSWORD_MIN_LENGTH} 至 ${PASSWORD_MAX_LENGTH} 位`;
  } else if (input.rejectSameAsCurrent && input.newPassword === input.currentPassword) {
    errors.newPassword = '新密码不能与初始密码相同';
  }
  if (!input.confirmPassword) {
    errors.confirmPassword = '请再次输入新密码';
  } else if (input.confirmPassword !== input.newPassword) {
    errors.confirmPassword = '两次输入的新密码不一致';
  }
  return errors;
}

interface SessionResponse {
  user?: User | null;
}

/** 校验认证接口返回结构，确保响应包含 user 字段后再交由状态层消费 */
function extractUser(result: SessionResponse | null): User | null {
  if (!result || !('user' in result)) {
    throw new ApiError(500, '服务返回异常，请稍后重试。');
  }
  return result.user ?? null;
}

/** 查询当前已登录用户会话信息，未登录时返回 null。 */
export async function fetchSession(signal?: AbortSignal): Promise<User | null> {
  const result = await apiRequest<SessionResponse>('/api/auth/session', { signal });
  return extractUser(result);
}

/** 使用账号与密码登录并建立服务端会话。 */
export async function loginWithCredentials(username: string, password: string): Promise<User | null> {
  const result = await apiRequest<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return extractUser(result);
}

/** 校验当前密码并自助修改密码，服务端同步清除待改密标记并轮换当前会话。 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<User> {
  const result = await apiRequest<SessionResponse>('/api/auth/change-password', {
    method: 'POST',
    body: {
      current_password: currentPassword,
      new_password: newPassword,
    },
  });
  const user = extractUser(result);
  if (!user) {
    throw new ApiError(500, '服务返回异常，请稍后重试。');
  }
  return user;
}

/** 退出当前登录会话并清理服务端 Cookie。 */
export async function logoutSession(): Promise<void> {
  await apiRequest<SessionResponse>('/api/auth/logout', {
    method: 'POST',
  });
}
