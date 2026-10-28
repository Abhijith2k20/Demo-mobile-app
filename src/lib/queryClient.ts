import { QueryClient } from '@tanstack/react-query';

// Cache of API replies for every screen; cleared on sign-out and user switch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15_000, gcTime: 30 * 60_000, refetchOnReconnect: false },
  },
});
