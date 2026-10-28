import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { get, keys, refresh } from '@/lib/queries';
import type { ActivityView } from '@/types/models';

export function useActivityFeed() {
  return useQuery({ queryKey: keys.activity, queryFn: get<{ items: ActivityView[]; unreadCount: number }>('/activity') });
}

export function useUnreadActivityCount(): number {
  return useActivityFeed().data?.unreadCount ?? 0;
}

export function useActivity() {
  const q = useActivityFeed();
  return { items: q.data?.items ?? [], loading: q.isPending && !q.isError, failed: q.isError && !q.data };
}

/** "Seen" is kept by the server, so every device of the user agrees. */
export function markActivityRead(): void {
  api('POST', '/activity/read')
    .then(() => refresh(keys.activity))
    .catch(() => {});
}
