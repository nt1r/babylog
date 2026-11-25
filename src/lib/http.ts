/** 统一的接口请求异常，携带 HTTP 状态码（网络中断时为 0）、可选错误码与面向用户的中文提示 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let unauthorizedHandler: (() => void) | null = null;
let passwordChangeRequiredHandler: (() => void) | null = null;

/** 注册全局 401 未认证回调（用于业务接口会话过期时清理登录态并跳回登录页）。 */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

/** 注册全局 403 PASSWORD_CHANGE_REQUIRED 回调（用于强制改密状态变更时刷新会话并触发改密门禁）。 */
export function setPasswordChangeRequiredHandler(handler: (() => void) | null) {
  passwordChangeRequiredHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** 统一封装后端 JSON 接口请求，处理取消透传、非认证接口 401 全局清态以及中文错误提取。 */
export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    // 主动取消的请求须原样抛出 AbortError，供 TanStack Query / AbortController 静默忽略而非提示网络错误。
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, '暂时无法连接服务，请稍后重试。');
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errorCode =
      data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : undefined;
    // 登录接口 401 与改密接口当前密码错误（INVALID_CREDENTIALS）由表单本地展示；
    // 其余业务接口或改密接口会话失效的 401 统一触发全局退登清态。
    const isLocalCredentialError =
      url.startsWith('/api/auth/') && (url !== '/api/auth/change-password' || errorCode === 'INVALID_CREDENTIALS');
    if (response.status === 401 && !isLocalCredentialError) {
      unauthorizedHandler?.();
    } else if (response.status === 403 && errorCode === 'PASSWORD_CHANGE_REQUIRED') {
      passwordChangeRequiredHandler?.();
    }
    const errorMessage =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : '操作未完成，请稍后重试。';
    throw new ApiError(response.status, errorMessage, errorCode);
  }

  return data as T;
}
