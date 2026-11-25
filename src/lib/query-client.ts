import { QueryClient } from '@tanstack/react-query';

export const BABY_QUERY_KEY = ['baby-profile'] as const;
export const RECORDS_QUERY_KEY = ['records'] as const;
export const RECORD_DEFAULTS_QUERY_KEY = ['record-defaults'] as const;
export const DASHBOARD_QUERY_KEY = ['dashboard'] as const;
export const DASHBOARD_SUMMARY_QUERY_KEY = [...DASHBOARD_QUERY_KEY, 'summary'] as const;
export const VACCINES_QUERY_KEY = ['vaccines'] as const;
export const VACCINE_CATALOG_QUERY_KEY = ['vaccine-catalog'] as const;

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
