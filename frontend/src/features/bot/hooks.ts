import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useOutbox } from '@/lib/outbox';
import { get, keys } from '@/lib/queries';
import type { Card, ID } from '@/types/models';

/** The signed-in person's cards, oldest first. An answer still in the send queue shows as given, marked as sending. */
export function useMyCards(): { cards: Card[]; loading: boolean } {
  const q = useQuery({ queryKey: keys.cards, queryFn: get<{ cards: Card[] }>('/me/cards') });
  const items = useOutbox((st) => st.items);
  const cards = useMemo(() => {
    const queued = new Map(items.flatMap((i) => (i.kind === 'card' && i.state !== 'failed' ? [[i.cardId, i] as const] : [])));
    return (q.data?.cards ?? []).map((c): Card => {
      const mine = c.state === 'open' ? queued.get(c.id) : undefined;
      return mine ? { ...c, state: 'answered', answer: { ...mine.answer, photoUploadIds: mine.photos.map((p) => p.attachmentId) }, answeredAt: mine.createdAt, sending: true } : c;
    });
  }, [q.data, items]);
  return { cards, loading: q.isPending };
}

export function useCard(id: ID | null | undefined): Card | null {
  const { cards } = useMyCards();
  return cards.find((c) => c.id === id) ?? null;
}

/** A card that asks something (a scale or buttons); the others are information, like a morning summary. */
export const asks = (c: Card): boolean => !!(c.content.scale?.length || c.content.buttons?.length);
