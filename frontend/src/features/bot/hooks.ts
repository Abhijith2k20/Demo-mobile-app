import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '@/lib/api/client';
import { useOutbox } from '@/lib/outbox';
import { get, keys } from '@/lib/queries';
import type { Checkin, ID } from '@/types/models';

/**
 * When the bot conversation opens, ask the server to check in on every open task the user owns.
 * The cards arrive as live events. Offline, nothing happens; the next open tries again.
 */
export function useAskOnOpen(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    api('POST', '/bot/checkins').catch(() => {});
  }, [enabled]);
}

/** The signed-in person's check-ins, oldest first. An answer still in the send queue shows as given, marked as sending. */
export function useMyCheckins(): { checkins: Checkin[]; loading: boolean } {
  const q = useQuery({ queryKey: keys.checkins, queryFn: get<{ checkins: Checkin[] }>('/me/checkins') });
  const items = useOutbox((st) => st.items);
  const checkins = useMemo(() => {
    const queued = new Map(items.flatMap((i) => (i.kind === 'checkin' && i.state !== 'failed' ? [[i.checkinId, { answer: i.answer, at: i.createdAt }] as const] : [])));
    return (q.data?.checkins ?? []).map((c) => {
      const mine = c.answer ? undefined : queued.get(c.id);
      return mine ? { ...c, answer: { ...mine.answer, at: mine.at }, sending: true } : c;
    });
  }, [q.data, items]);
  return { checkins, loading: q.isPending };
}

export function useCheckin(id: ID | null | undefined): Checkin | null {
  const { checkins } = useMyCheckins();
  return checkins.find((c) => c.id === id) ?? null;
}
