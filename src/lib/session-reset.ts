import { queryClient } from '@/lib/query-client';
import { useBabyStore } from '@/stores/baby';
import { useBatchRecordStore } from '@/stores/batch-record';
import { useCommandPaletteStore } from '@/stores/command-palette';
import { useExportDrawerStore } from '@/stores/export-drawer';
import { useGrowthRecordStore } from '@/stores/growth-record';
import { useQuickRecordStore } from '@/stores/quick-record';

/**
 * 统一清理所有与当前登录账号绑定的客户端状态：
 * 清空 TanStack Query 缓存、重置当前选中宝宝、关闭命令面板并关闭/重置快捷、批量补录、生长发育与数据导出抽屉，
 * 用于退出登录、401 会话失效与同设备切换账号时阻断跨用户数据残留。
 */
export function resetClientSessionState(): void {
  queryClient.clear();
  useQuickRecordStore.getState().reset();
  useBatchRecordStore.getState().reset();
  useGrowthRecordStore.getState().reset();
  useExportDrawerStore.getState().reset();
  useCommandPaletteStore.getState().setOpen(false);
  useBabyStore.getState().reset();
}
