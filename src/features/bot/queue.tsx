// The check-in queue: which cards are waiting, and which single one is open right now.
// Only one card is expanded at a time, so the bot asks one question at a time.
import { asc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { db } from '@/lib/db/client';
import { checkins } from '@/lib/db/schema';
import { useNow } from '@/lib/useNow';
import type { ID } from '@/types/models';

/** Check-ins asked within this window count as "this round" for the progress bar. */
const ROUND_MS = 18 * 60 * 60 * 1000;

interface Queue {
  /** Unanswered check-ins, oldest first. */
  pending: ID[];
  /** The one card that is open, or null when nothing is waiting. */
  activeId: ID | null;
  open: (id: ID) => void;
  /** Answered and total for the current round. */
  answered: number;
  total: number;
}

const QueueContext = createContext<Queue | null>(null);

export function CheckinQueueProvider({ children }: { children: ReactNode }) {
  // Only the signed-in user's check-ins are ever stored on the phone.
  const all = useLiveQuery(db.select().from(checkins).orderBy(asc(checkins.askedAt), asc(checkins.id))).data;
  const [picked, setPicked] = useState<ID | null>(null);
  const now = useNow(60_000);
  const value = useMemo<Queue>(() => {
    const pending = all.filter((c) => !c.answer).map((c) => c.id);
    const round = all.filter((c) => now - Date.parse(c.askedAt) < ROUND_MS || !c.answer);
    return {
      pending,
      // The user's pick while it is still waiting; otherwise the oldest waiting one.
      activeId: picked && pending.includes(picked) ? picked : (pending[0] ?? null),
      open: setPicked,
      answered: round.filter((c) => c.answer).length,
      total: round.length,
    };
  }, [all, picked, now]);
  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

/** Null outside the bot conversation (a card shown elsewhere is simply always open). */
export function useCheckinQueue(): Queue | null {
  return useContext(QueueContext);
}
