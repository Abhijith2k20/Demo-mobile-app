// Rule 2 — lanes. Same lane → strict order. Different lanes → independent.
import type { ID, OutboxItem } from '@/types/models';

export const lanes = {
  channel: (id: ID) => `channel:${id}`,
  task: (id: ID) => `task:${id}`,
  project: (id: ID) => `project:${id}`,
  upload: 'upload',
  meta: 'meta',
} as const;

export type Slot = 'main' | 'upload';

/**
 * Picks the next item a slot may send: the head of a lane that is due, not in flight and not
 * waiting on a dependency. Failed items are parked and do not block their lane.
 * `items` must be ordered oldest first.
 */
export function pickNext(items: OutboxItem[], slot: Slot, now: number): OutboxItem | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (const item of items) {
    if (item.status === 'failed') continue;
    if (seen.has(item.lane)) continue;
    seen.add(item.lane);
    if ((slot === 'upload') !== (item.lane === lanes.upload)) continue;
    if (item.status === 'sending') continue;
    if (item.nextAttemptAt > now) continue;
    if (item.dependsOn && byId.has(item.dependsOn)) continue; // e.g. a photo message waits for its upload
    return item;
  }
  return null;
}
