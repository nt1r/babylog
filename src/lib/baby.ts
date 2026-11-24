import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/http';
import { parseOptionalStrictNumber } from '@/lib/number';
import { VACCINES_QUERY_KEY } from '@/lib/query-client';
import { getBrowserTimeZone } from '@/lib/time';

export type BabyGender = 'male' | 'female' | 'unknown';

export interface BabyProfile {
  id: number;
  nickname: string;
  birth_date: string;
  gender: BabyGender;
  birth_weight_kg: number | null;
  birth_height_cm: number | null;
  created_at: string;
  updated_at: string;
}

export interface BabyUpsertInput {
  nickname: string;
  birth_date: string;
  gender: BabyGender;
  birth_weight_kg: number | null;
  birth_height_cm: number | null;
}

interface BabyResponse {
  baby: BabyProfile | null;
}

export const BABY_QUERY_KEY = ['baby-profile'] as const;

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
}

/** 统一校验宝宝档案表单（供建档页与设置页复用，上下限与后端保持一致）。 */
export function validateBabyProfileForm(input: {
  nickname: string;
  birthDate: string;
  gender: BabyGender;
  birthWeight: string;
  birthHeight: string;
  todayStr: string;
}): { payload: BabyUpsertInput | null; errors: BabyFormValidationErrors } {
  const errors: BabyFormValidationErrors = {};
  const trimmedName = input.nickname.trim();
  if (!trimmedName) {
    errors.nickname = '请填写宝宝昵称';
  }
  if (!input.birthDate) {
    errors.birthDate = '请选择出生日期';
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

  if (errors.nickname || errors.birthDate || errors.birthWeight || errors.birthHeight) {
    return { payload: null, errors };
  }

  return {
    payload: {
      nickname: trimmedName,
      birth_date: input.birthDate,
      gender: input.gender,
      birth_weight_kg: weight === 'invalid' ? null : weight,
      birth_height_cm: height === 'invalid' ? null : height,
    },
    errors: {},
  };
}

export async function fetchBabyProfile(signal?: AbortSignal): Promise<BabyProfile | null> {
  const res = await apiRequest<BabyResponse>('/api/baby', { signal });
  return res.baby ?? null;
}

export async function createBabyProfile(input: BabyUpsertInput): Promise<BabyProfile> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  const res = await apiRequest<{ baby: BabyProfile }>(`/api/baby?tz=${tz}`, {
    method: 'POST',
    body: input,
  });
  return res.baby;
}

export async function updateBabyProfile(input: BabyUpsertInput): Promise<BabyProfile> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  const res = await apiRequest<{ baby: BabyProfile }>(`/api/baby?tz=${tz}`, {
    method: 'PUT',
    body: input,
  });
  return res.baby;
}

export function useBabyProfileQuery(enabled = true) {
  return useQuery({
    queryKey: BABY_QUERY_KEY,
    queryFn: ({ signal }) => fetchBabyProfile(signal),
    enabled,
  });
}

export function useCreateBabyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBabyProfile,
    onSuccess: (baby) => {
      queryClient.setQueryData(BABY_QUERY_KEY, baby);
    },
  });
}

export function useUpdateBabyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBabyProfile,
    onSuccess: (baby) => {
      queryClient.setQueryData(BABY_QUERY_KEY, baby);
      // 修改出生日期会联动重算未手动覆盖的疫苗预计接种日期，同步失效疫苗计划缓存。
      void queryClient.invalidateQueries({ queryKey: VACCINES_QUERY_KEY });
    },
  });
}
