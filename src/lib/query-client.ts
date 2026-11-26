import { QueryClient } from '@tanstack/react-query';

/** 管理员用户列表查询键。 */
export const ADMIN_USERS_QUERY_KEY = ['admin', 'users'] as const;

/** 当前登录用户旗下的宝宝列表查询键（按 userId 隔离）。 */
export function babiesQueryKey(userId: number | null) {
  return ['user', userId, 'babies'] as const;
}

/** 单个宝宝作用域的根查询键（删除宝宝时用于一次性清除其全部业务缓存）。 */
export function babyScopeQueryKey(babyId: number | null) {
  return ['babies', babyId] as const;
}

/** 宝宝日常记录列表查询键。 */
export function babyRecordsQueryKey(babyId: number | null) {
  return ['babies', babyId, 'records'] as const;
}

/** 宝宝智能默认值查询键。 */
export function babyRecordDefaultsQueryKey(babyId: number | null) {
  return ['babies', babyId, 'record-defaults'] as const;
}

/** 宝宝看板根查询键。 */
export function babyDashboardQueryKey(babyId: number | null) {
  return ['babies', babyId, 'dashboard'] as const;
}

/** 宝宝看板今日汇总查询键（首页看板与生长发育概览共享）。 */
export function babyDashboardSummaryQueryKey(babyId: number | null) {
  return ['babies', babyId, 'dashboard', 'summary'] as const;
}

/** 宝宝疫苗接种计划查询键。 */
export function babyVaccinesQueryKey(babyId: number | null) {
  return ['babies', babyId, 'vaccines'] as const;
}

/** 宝宝疫苗目录查询键。 */
export function babyVaccineCatalogQueryKey(babyId: number | null) {
  return ['babies', babyId, 'vaccine-catalog'] as const;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
