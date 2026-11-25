import { queryClient } from '@/lib/query-client';
import { useBabyStore } from '@/stores/baby';
import { useCommandPaletteStore } from '@/stores/command-palette';
import { useGrowthRecordStore } from '@/stores/growth-record';
import { useQuickRecordStore } from '@/stores/quick-record';

/**
 * 统一清理所有与当前登录账号绑定的客户端状态：
 * 清空 TanStack Query 缓存、重置当前选中宝宝、关闭命令面板并关闭/重置快捷与生长发育录入抽屉，
 * 用于退出登录、401 会话失效与同设备切换账号时阻断跨用户数据残留。
 */
export function resetClientSessionState(): void {
  queryClient.clear();
  useQuickRecordStore.getState().reset();
  useGrowthRecordStore.getState().reset();
  useCommandPaletteStore.getState().setOpen(false);
  useBabyStore.getState().reset();
}
