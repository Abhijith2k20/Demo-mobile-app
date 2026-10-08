import { QueryClient } from '@tanstack/react-query';

// Used only for screens that are not offline-first (dashboard, company directory).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15_000, gcTime: 30 * 60_000, refetchOnReconnect: false },
  },
});
