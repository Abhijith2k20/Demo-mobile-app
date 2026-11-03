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
  /** When the PM app last called Siteline. */
  lastCallAt?: string | null;
  /** The last answer that couldn't be delivered, in plain words. */
  lastError?: string | null;
}

export function usePmLink(enabled: boolean): PmLink | undefined {
  return useQuery({ queryKey: keys.integration, queryFn: get<PmLink>('/integration'), enabled }).data;
}
