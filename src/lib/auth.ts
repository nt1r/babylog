import { ApiError, apiRequest } from '@/lib/http';

export interface User {
  username: string;
  role: 'admin';
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

export async function fetchSession(signal?: AbortSignal): Promise<User | null> {
  const result = await apiRequest<SessionResponse>('/api/auth/session', { signal });
  return extractUser(result);
}

export async function loginWithCredentials(username: string, password: string): Promise<User | null> {
  const result = await apiRequest<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return extractUser(result);
}

export async function logoutSession(): Promise<void> {
  await apiRequest<SessionResponse>('/api/auth/logout', {
    method: 'POST',
  });
}
