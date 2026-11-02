import { useQuery } from '@tanstack/react-query';
import { get, keys } from '@/lib/queries';
import type { SentInvite } from '@/types/models';

export function useInvites(enabled: boolean): { invites: SentInvite[]; loading: boolean } {
  const q = useQuery({ queryKey: keys.invites, queryFn: get<{ invites: SentInvite[] }>('/invites'), enabled });
  return { invites: q.data?.invites ?? [], loading: q.isPending && enabled };
}

export interface PmLink {
  connected: boolean;
  kind?: 'mock' | 'http';
  lastSyncAt?: string | null;
  lastError?: string | null;
  /** People the PM app names who aren't in this company on Siteline yet. */
  unmatched?: string[];
}

export function usePmLink(enabled: boolean): PmLink | undefined {
  return useQuery({ queryKey: keys.integration, queryFn: get<PmLink>('/integration'), enabled }).data;
}
