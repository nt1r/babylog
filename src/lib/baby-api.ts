import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '@/lib/http';
import {
  babiesQueryKey,
  babyDashboardQueryKey,
  babyDashboardSummaryQueryKey,
  babyRecordDefaultsQueryKey,
  babyRecordsQueryKey,
  babyVaccineCatalogQueryKey,
  babyVaccinesQueryKey,
} from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';
import { useAuthStore } from '@/stores/auth';
import { useBabyStore } from '@/stores/baby';

type BabyInvalidationScope = 'records' | 'vaccines' | 'vaccines-catalog' | 'vaccines-clinic' | 'baby-profile';

interface BabyPathOptions {
  readonly tz?: boolean;
  readonly timeZone?: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
}

interface BabyRequestOptions extends BabyPathOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/** 统一构造 `/api/babies/:babyId/...` 业务路径，按需自动附加浏览器时区 `tz` 与其他查询参数。 */
export function buildBabyApiPath(babyId: number, subPath: string, options: BabyPathOptions = {}): string {
  const normalizedSubPath = subPath.startsWith('/') || subPath === '' ? subPath : `/${subPath}`;
  const params = new URLSearchParams();
  if (options.tz) {
    params.set('tz', options.timeZone ?? getBrowserTimeZone());
  }
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    }
  }
  const qs = params.toString();
  return `/api/babies/${babyId}${normalizedSubPath}${qs ? `?${qs}` : ''}`;
}

/** 面向宝宝作用域业务接口的统一 JSON 请求封装，复用全局 401 清理与错误解析基线。 */
export function babyApiRequest<T>(babyId: number, subPath: string, options: BabyRequestOptions = {}): Promise<T> {
  const { method, body, signal, ...pathOptions } = options;
  return apiRequest<T>(buildBabyApiPath(babyId, subPath, pathOptions), { method, body, signal });
}

/**
 * 集中式跨领域缓存失效表：统一收口记录写入、疫苗变更、ADR-0002 常去门诊同步与宝宝档案更新的联动刷新规则，
 * 避免各领域 Hook 散落维护重复的 queryKey 失效列表。
 */
export function invalidateBabyDomain(queryClient: QueryClient, babyId: number, scope: BabyInvalidationScope): void {
  switch (scope) {
    case 'records':
      void queryClient.invalidateQueries({ queryKey: babyRecordsQueryKey(babyId) });
      void queryClient.invalidateQueries({ queryKey: babyRecordDefaultsQueryKey(babyId) });
      void queryClient.invalidateQueries({ queryKey: babyDashboardQueryKey(babyId) });
      return;
    case 'vaccines':
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(babyId) });
      return;
    case 'vaccines-catalog':
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(babyId) });
      void queryClient.invalidateQueries({ queryKey: babyVaccineCatalogQueryKey(babyId) });
      return;
    case 'vaccines-clinic': {
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(babyId) });
      const userId = useAuthStore.getState().user?.id ?? null;
      if (userId !== null) {
        void queryClient.invalidateQueries({ queryKey: babiesQueryKey(userId) });
      }
      return;
    }
    case 'baby-profile':
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(babyId) });
      void queryClient.invalidateQueries({ queryKey: babyDashboardQueryKey(babyId) });
      return;
  }
}

/**
 * 看板今日汇总的共享查询选项（首页看板与生长发育概览经 useBabyQuery 共用同一 queryKey 与请求路径），
 * 单一事实来源确保两处复用缓存时绝不因路径或载荷漂移互相污染。
 */
export function dashboardSummaryQueryOptions<T>() {
  return {
    queryKey: babyDashboardSummaryQueryKey,
    queryFn: (babyId: number, signal: AbortSignal) =>
      babyApiRequest<T>(babyId, '/dashboard/summary', { tz: true, signal }),
  };
}

/** 宝宝作用域通用查询 Hook：统一注入当前活跃宝宝 ID、空态门控与未选宝宝防御。 */
export function useBabyQuery<TQueryFnData, TData = TQueryFnData>(options: {
  readonly queryKey: (babyId: number | null) => QueryKey;
  readonly queryFn: (babyId: number, signal: AbortSignal) => Promise<TQueryFnData>;
  readonly enabled?: boolean;
  readonly staleTime?: number;
  readonly refetchInterval?: number | false;
  readonly select?: (data: TQueryFnData) => TData;
}) {
  const activeBabyId = useBabyStore((state) => state.activeBabyId);
  return useQuery({
    queryKey: options.queryKey(activeBabyId),
    queryFn: ({ signal }) => {
      if (activeBabyId === null) throw new ApiError(400, '请先选择宝宝档案。');
      return options.queryFn(activeBabyId, signal);
    },
    enabled: (options.enabled ?? true) && activeBabyId !== null,
    ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
    ...(options.select !== undefined ? { select: options.select } : {}),
  });
}

/** 宝宝作用域通用变更 Hook：统一捕获目标宝宝 ID（兜底读取最新 Store）并按声明范围执行跨领域缓存失效。 */
export function useBabyMutation<TData, TVariables>(options: {
  readonly mutationFn: (babyId: number, variables: TVariables, queryClient: QueryClient) => Promise<TData>;
  readonly invalidate?: BabyInvalidationScope;
}) {
  const queryClient = useQueryClient();
  const activeBabyId = useBabyStore((state) => state.activeBabyId);
  return useMutation({
    mutationFn: async (variables: TVariables) => {
      const targetBabyId = activeBabyId ?? useBabyStore.getState().activeBabyId;
      if (targetBabyId === null) {
        throw new ApiError(400, '请先选择宝宝档案。');
      }
      const result = await options.mutationFn(targetBabyId, variables, queryClient);
      if (options.invalidate) {
        invalidateBabyDomain(queryClient, targetBabyId, options.invalidate);
      }
      return result;
    },
  });
}
