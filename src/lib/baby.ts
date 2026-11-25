import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { ApiError, apiRequest } from '@/lib/http';
import { parseOptionalStrictNumber } from '@/lib/number';
import { babiesQueryKey, babyDashboardQueryKey, babyScopeQueryKey, babyVaccinesQueryKey } from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';
import { useAuthStore } from '@/stores/auth';
import { useBabyStore } from '@/stores/baby';

export type BabyGender = 'male' | 'female' | 'unknown';

export const MAX_BABIES_PER_USER = 10;

export interface BabyProfile {
  id: number;
  nickname: string;
  birth_date: string;
  gender: BabyGender;
  birth_weight_kg: number | null;
  birth_height_cm: number | null;
  default_clinic_name: string;
  created_at: string;
  updated_at: string;
}

interface BabyUpsertInput {
  nickname: string;
  birth_date: string;
  gender: BabyGender;
  birth_weight_kg: number | null;
  birth_height_cm: number | null;
  default_clinic_name?: string;
}

interface BabiesListResponse {
  babies: BabyProfile[];
}

export const BABY_GENDER_LABELS: Record<BabyGender, string> = {
  male: '男宝',
  female: '女宝',
  unknown: '暂不透露',
};

export interface BabyFormValidationErrors {
  nickname?: string;
  birthDate?: string;
  birthWeight?: string;
  birthHeight?: string;
  defaultClinicName?: string;
}

const MIN_BIRTH_DATE = '1900-01-01';

/** 统一校验宝宝档案表单（供建档页、添加宝宝弹窗与设置页复用，上下限与后端保持一致）。 */
export function validateBabyProfileForm(input: {
  nickname: string;
  birthDate: string;
  gender: BabyGender;
  birthWeight: string;
  birthHeight: string;
  defaultClinicName?: string;
  todayStr: string;
}): { payload: BabyUpsertInput | null; errors: BabyFormValidationErrors } {
  const errors: BabyFormValidationErrors = {};
  const trimmedName = input.nickname.trim();
  if (!trimmedName) {
    errors.nickname = '请填写宝宝昵称';
  } else if (Array.from(trimmedName).length > 32) {
    errors.nickname = '宝宝昵称最多 32 个字';
  }
  if (!input.birthDate) {
    errors.birthDate = '请选择出生日期';
  } else if (input.birthDate < MIN_BIRTH_DATE) {
    errors.birthDate = '出生日期不能早于 1900-01-01';
  } else if (input.birthDate > input.todayStr) {
    errors.birthDate = '出生日期不能晚于今天';
  }

  const weight = parseOptionalStrictNumber(input.birthWeight);
  if (weight === 'invalid' || (weight !== null && (weight < 0.3 || weight > 15))) {
    errors.birthWeight = '请输入 0.3 至 15 kg 之间的数值';
  }

  const height = parseOptionalStrictNumber(input.birthHeight);
  if (height === 'invalid' || (height !== null && (height < 20 || height > 100))) {
    errors.birthHeight = '请输入 20 至 100 cm 之间的数值';
  }

  let normalizedClinic: string | undefined;
  if (input.defaultClinicName !== undefined) {
    const trimmedClinic = input.defaultClinicName.trim();
    if (Array.from(trimmedClinic).length > 80) {
      errors.defaultClinicName = '常去接种门诊最多 80 个字';
    } else {
      normalizedClinic = trimmedClinic;
    }
  }

  if (errors.nickname || errors.birthDate || errors.birthWeight || errors.birthHeight || errors.defaultClinicName) {
    return { payload: null, errors };
  }

  return {
    payload: {
      nickname: trimmedName,
      birth_date: input.birthDate,
      gender: input.gender,
      birth_weight_kg: weight === 'invalid' ? null : weight,
      birth_height_cm: height === 'invalid' ? null : height,
      ...(normalizedClinic !== undefined ? { default_clinic_name: normalizedClinic } : {}),
    },
    errors: {},
  };
}

/** 统一解析写操作提交时的目标宝宝 ID（优先采用调用方捕获值，兜底读取最新 Store 状态）。 */
export function resolveMutationBabyId(activeBabyId: number | null): number {
  const targetBabyId = activeBabyId ?? useBabyStore.getState().activeBabyId;
  if (targetBabyId === null) {
    throw new ApiError(400, '请先选择宝宝档案。');
  }
  return targetBabyId;
}

async function fetchBabies(signal?: AbortSignal): Promise<BabyProfile[]> {
  const res = await apiRequest<BabiesListResponse>('/api/babies', { signal });
  return Array.isArray(res.babies) ? res.babies : [];
}

async function createBabyProfile(input: BabyUpsertInput): Promise<BabyProfile> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  const res = await apiRequest<{ baby: BabyProfile }>(`/api/babies?tz=${tz}`, {
    method: 'POST',
    body: input,
  });
  return res.baby;
}

async function updateBabyProfile(babyId: number, input: BabyUpsertInput): Promise<BabyProfile> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  const res = await apiRequest<{ baby: BabyProfile }>(`/api/babies/${babyId}?tz=${tz}`, {
    method: 'PUT',
    body: input,
  });
  return res.baby;
}

async function deleteBabyProfile(babyId: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/babies/${babyId}`, {
    method: 'DELETE',
  });
}

/** 查询当前登录用户旗下的全部宝宝档案列表（按创建顺序升序）。 */
export function useBabiesQuery(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery({
    queryKey: babiesQueryKey(userId),
    queryFn: ({ signal }) => fetchBabies(signal),
    enabled: enabled && userId !== null,
  });
}

/**
 * 顶层认证布局专用的宝宝列表与当前选中宝宝同步 Hook：
 * 全应用仅在 `_app.tsx` 挂载一处，读取 `localStorage` 并在绘制前同步 `useBabyStore`，
 * 避免各业务子组件重复读写 `localStorage` 或触发多次冗余同步副作用。
 */
export function useSyncActiveBaby(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const syncedUserId = useBabyStore((state) => state.syncedUserId);
  const syncActiveBaby = useBabyStore((state) => state.syncActiveBaby);
  const babiesQuery = useBabiesQuery(enabled);
  const babies = babiesQuery.data ?? [];

  useLayoutEffect(() => {
    if (!enabled || userId === null || !babiesQuery.isSuccess) return;
    syncActiveBaby(userId, babies);
  }, [enabled, userId, babiesQuery.isSuccess, babies, syncActiveBaby]);

  return {
    babies,
    babiesQuery,
    isSynced: !enabled || userId === null || !babiesQuery.isSuccess || syncedUserId === userId,
  };
}

/** 轻量只读 Selector：直接读取当前选中的宝宝 ID，不触发列表查询与存储副作用。 */
export function useActiveBabyId(): number | null {
  return useBabyStore((state) => state.activeBabyId);
}

/** 读取当前宝宝列表、活跃宝宝实体及切换动作（仅在需要宝宝详情或切换 UI 的页面/组件调用）。 */
export function useActiveBaby(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const storedBabyId = useBabyStore((state) => state.activeBabyId);
  const setActiveBabyId = useBabyStore((state) => state.setActiveBabyId);
  const babiesQuery = useBabiesQuery(enabled);

  const babies = babiesQuery.data ?? [];
  const activeBaby =
    (storedBabyId !== null ? babies.find((b) => b.id === storedBabyId) : undefined) ?? babies[0] ?? null;

  return {
    babies,
    activeBaby,
    activeBabyId: activeBaby?.id ?? null,
    babiesQuery,
    selectBaby: (babyId: number) => setActiveBabyId(userId, babyId),
  };
}

/** 创建宝宝档案并在成功后追加至缓存且设为当前活跃宝宝。 */
export function useCreateBabyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBabyProfile,
    onSuccess: (baby) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      if (userId !== null) {
        queryClient.setQueryData<BabyProfile[]>(babiesQueryKey(userId), (prev) => {
          const list = prev ?? [];
          if (list.some((item) => item.id === baby.id)) return list;
          return [...list, baby];
        });
        useBabyStore.getState().setActiveBabyId(userId, baby.id);
      }
    },
  });
}

/** 更新指定宝宝档案，并同步失效该宝宝的疫苗排期与看板概览缓存。 */
export function useUpdateBabyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ babyId, input }: { readonly babyId: number; readonly input: BabyUpsertInput }) =>
      updateBabyProfile(babyId, input),
    onSuccess: (baby) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      if (userId !== null) {
        queryClient.setQueryData<BabyProfile[]>(babiesQueryKey(userId), (prev) =>
          (prev ?? []).map((item) => (item.id === baby.id ? baby : item)),
        );
      }
      // 修改出生日期或出生体重/身高会联动影响疫苗预计接种日与生长概览兜底，同步失效该宝宝的两类缓存。
      void queryClient.invalidateQueries({ queryKey: babyVaccinesQueryKey(baby.id) });
      void queryClient.invalidateQueries({ queryKey: babyDashboardQueryKey(baby.id) });
    },
  });
}

/** 硬删除指定宝宝档案，同步移除其业务缓存并切换至剩余首个宝宝（若无剩余则置空）。 */
export function useDeleteBabyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBabyProfile,
    onSuccess: (_data, deletedBabyId) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      let remaining: BabyProfile[] = [];
      if (userId !== null) {
        queryClient.setQueryData<BabyProfile[]>(babiesQueryKey(userId), (prev) => {
          remaining = (prev ?? []).filter((item) => item.id !== deletedBabyId);
          return remaining;
        });
        const nextBabyId = remaining[0]?.id ?? null;
        useBabyStore.getState().setActiveBabyId(userId, nextBabyId);
      }
      queryClient.removeQueries({ queryKey: babyScopeQueryKey(deletedBabyId) });
    },
  });
}
