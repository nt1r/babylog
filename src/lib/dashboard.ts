import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/http';
import { getBrowserTimeZone } from '@/lib/time';

export interface DashboardSummary {
  date: string;
  timezone: string;
  feeding: {
    total_ml: number;
    formula_count: number;
    bottle_breast_count: number;
    direct_breast_count: number;
    direct_breast_min: number;
    solid_count: number;
    total_count: number;
    last_feeding_at: string | null;
  };
  sleep: {
    total_min: number;
    nap_count: number;
    nap_min: number;
    night_count: number;
    night_min: number;
  };
  health: {
    latest_temp_c: number | null;
    latest_temp_at: string | null;
  };
  care: {
    total_count: number;
    diaper_count: number;
    pee_count: number;
    poop_count: number;
    bath_count: number;
    other_count: number;
    last_diaper_at: string | null;
  };
}

export interface DashboardTrends {
  days: number;
  timezone: string;
  daily: Array<{
    date: string;
    label: string;
    feeding_ml: number;
    direct_breast_min: number;
    direct_breast_count: number;
    sleep_hours: number;
  }>;
  slots: Array<{
    slot: string;
    count: number;
  }>;
}

export async function fetchDashboardSummary(signal?: AbortSignal): Promise<DashboardSummary> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  return apiRequest<DashboardSummary>(`/api/dashboard/summary?tz=${tz}`, { signal });
}

export async function fetchDashboardTrends(days = 7, signal?: AbortSignal): Promise<DashboardTrends> {
  const tz = encodeURIComponent(getBrowserTimeZone());
  return apiRequest<DashboardTrends>(`/api/dashboard/trends?days=${days}&tz=${tz}`, { signal });
}

export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: ({ signal }) => fetchDashboardSummary(signal),
    refetchInterval: 60_000,
  });
}

export function useDashboardTrendsQuery(days = 7) {
  return useQuery({
    queryKey: ['dashboard', 'trends', days],
    queryFn: ({ signal }) => fetchDashboardTrends(days, signal),
  });
}
