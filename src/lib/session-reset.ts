import { queryClient } from '@/lib/query-client';
import { useBabyStore } from '@/stores/baby';
import { useOverlayStore } from '@/stores/overlays';

/**
 * 统一清理所有与当前登录账号绑定的客户端状态：
 * 清空 TanStack Query 缓存、强清全部全局浮层与保留意图并重置当前选中宝宝，
 * 用于退出登录、401 会话失效与同设备切换账号时阻断跨用户数据残留。
 */
export function resetClientSessionState(): void {
  queryClient.clear();
  useOverlayStore.getState().resetAll();
  useBabyStore.getState().reset();
}
