import { create } from 'zustand';
import { fetchSession, loginWithCredentials, logoutSession, type User } from '@/lib/auth';
import { resetClientSessionState } from '@/lib/session-reset';

interface AuthState {
  user: User | null;
  initialized: boolean;
  restoring: boolean;
  restoreFailed: boolean;
  restoreError: string;
  restoreSession: () => Promise<User | null>;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

// 维护在途会话恢复请求与递增版本号，防止旧请求返回时覆盖最新的登录/登出状态
let activeRestoreController: AbortController | null = null;
let activeRestorePromise: Promise<User | null> | null = null;
let authRevision = 0;

function cancelActiveRestore() {
  activeRestoreController?.abort();
  activeRestoreController = null;
  activeRestorePromise = null;
}

/** 账号认证会话 Zustand Store，内置在途恢复请求取消、版本号防竞态与切号清态机制。 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialized: false,
  restoring: true,
  restoreFailed: false,
  restoreError: '',

  setUser: (user) => {
    const prevUser = get().user;
    authRevision += 1;
    cancelActiveRestore();
    if (!user || (prevUser && prevUser.id !== user.id)) {
      resetClientSessionState();
    }
    set({ user, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
  },

  restoreSession: async () => {
    if (activeRestorePromise) return activeRestorePromise;

    const currentRevision = ++authRevision;
    const controller = new AbortController();
    activeRestoreController = controller;
    set({ restoring: true, restoreFailed: false, restoreError: '' });

    const request: Promise<User | null> = fetchSession(controller.signal)
      .then((user) => {
        if (controller.signal.aborted || currentRevision !== authRevision) {
          return get().user;
        }
        const prevUser = get().user;
        if (prevUser && (!user || prevUser.id !== user.id)) {
          resetClientSessionState();
        }
        set({ user, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
        return user;
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          currentRevision !== authRevision ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return get().user;
        }
        set({
          initialized: true,
          restoring: false,
          restoreFailed: true,
          restoreError: '暂时无法连接服务，请检查服务状态后重试。',
        });
        return null;
      })
      .finally(() => {
        if (activeRestoreController === controller) {
          activeRestoreController = null;
          activeRestorePromise = null;
        }
      });

    activeRestorePromise = request;
    return request;
  },

  login: async (username, password) => {
    // 发起前递增并取消在途恢复，返回后再递增一次，确保请求期间新触发的恢复结果不会覆盖本次登录态。
    authRevision += 1;
    cancelActiveRestore();
    const user = await loginWithCredentials(username, password);
    authRevision += 1;
    // 登录成功切换至全新会话前彻底清空缓存、当前选中宝宝与录入抽屉，阻断跨账号残留。
    resetClientSessionState();
    set({ user, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
    return user;
  },

  logout: async () => {
    // 与 login 相同的前后双递增版本号守卫，阻断并发会话恢复回写已登出状态。
    authRevision += 1;
    cancelActiveRestore();
    await logoutSession();
    authRevision += 1;
    resetClientSessionState();
    set({ user: null, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
  },
}));
