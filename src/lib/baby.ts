import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/http';
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
    },
  });
}
