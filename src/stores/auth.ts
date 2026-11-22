import { create } from 'zustand';
import { fetchSession, loginWithCredentials, logoutSession, type User } from '@/lib/auth';

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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialized: false,
  restoring: true,
  restoreFailed: false,
  restoreError: '',

  setUser: (user) => {
    authRevision += 1;
    cancelActiveRestore();
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
    authRevision += 1;
    cancelActiveRestore();
    const user = await loginWithCredentials(username, password);
    authRevision += 1;
    set({ user, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
    return user;
  },

  logout: async () => {
    authRevision += 1;
    cancelActiveRestore();
    await logoutSession();
    authRevision += 1;
    set({ user: null, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
  },
}));
