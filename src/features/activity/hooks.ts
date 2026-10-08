import { desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@/lib/db/client';
import { activity } from '@/lib/db/schema';

export function useActivity() {
  const q = useLiveQuery(db.select().from(activity).orderBy(desc(activity.createdAt), desc(activity.id)).limit(100));
  return { items: q.data, loading: !q.updatedAt };
}

/** "Seen" is kept on the phone only (the demo server has no read state for activity). */
export function markActivityRead(): void {
  db.update(activity).set({ readAt: new Date().toISOString() }).where(isNull(activity.readAt)).run();
}
