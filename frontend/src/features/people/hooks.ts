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
  /** The last 7 days: cards sent and answered; webhooks waiting or given up on. */
  stats?: { cardsSent: number; cardsAnswered: number; pending: number; failed: number };
  /** Recent webhooks to the PM app, newest first. */
  deliveries?: PmDelivery[];
}

export interface PmDelivery {
  id: string;
  event: string | null;
  cardTitle: string | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  error: string | null;
  refused: boolean;
  updatedAt: string;
  canRetry: boolean;
}

export function usePmLink(enabled: boolean): PmLink | undefined {
  return useQuery({ queryKey: keys.integration, queryFn: get<PmLink>('/integration'), enabled }).data;
}
