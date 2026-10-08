// Rule 3 — merge unsent changes. Never merge into an item that is `sending`.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/lib/db/client';
import { outbox } from '@/lib/db/schema';
import type { ID, OutboxItem, OutboxKind } from '@/types/models';
import { enqueue } from './enqueue';
import { readPayload, type Payloads } from './types';

function findPending(tx: Tx, kind: OutboxKind, entityId: ID): OutboxItem | undefined {
  return tx
    .select()
    .from(outbox)
    .where(and(eq(outbox.kind, kind), eq(outbox.entityId, entityId), eq(outbox.status, 'pending')))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .get();
}

/**
 * Enqueues `payload`, or folds it into the newest still-pending item of the same kind for the
 * same entity. `merge` receives the queued payload and returns the combined one.
 */
export function enqueueMerged<K extends OutboxKind>(
  tx: Tx,
  kind: K,
  lane: string,
  entityId: ID,
  payload: Payloads[K],
  merge: (queued: Payloads[K], incoming: Payloads[K]) => Payloads[K],
): ID {
  const existing = findPending(tx, kind, entityId);
  if (!existing) return enqueue(tx, kind, lane, entityId, payload);
  const merged = merge(readPayload<K>(existing), payload);
  // A merged item is fresh again: retry right away instead of waiting out an old backoff.
  tx.update(outbox)
    .set({ payload: JSON.stringify(merged), nextAttemptAt: 0 })
    .where(eq(outbox.id, existing.id))
    .run();
  return existing.id;
}

/** If the message itself hasn't been sent yet, change the queued send instead of adding an edit. */
export function editUnsentMessage(tx: Tx, messageId: ID, body: string): boolean {
  const queued = findPending(tx, 'send_message', messageId);
  if (!queued) return false;
  const p = readPayload<'send_message'>(queued);
  p.message.body = body;
  tx.update(outbox).set({ payload: JSON.stringify(p) }).where(eq(outbox.id, queued.id)).run();
  return true;
}

/** Deleting an unsent message removes it (and its uploads) from the outbox. Returns true if handled. */
export function removeUnsentMessage(tx: Tx, messageId: ID): boolean {
  const all = tx.select().from(outbox).where(eq(outbox.entityId, messageId)).all();
  const send = all.find((i) => i.kind === 'send_message');
  if (!send || send.status === 'sending') return false;
  const ids = all.map((i) => i.id);
  const uploads = tx.select().from(outbox).where(eq(outbox.kind, 'upload_file')).all();
  for (const u of uploads) {
    if (readPayload<'upload_file'>(u).messageId === messageId && u.status !== 'sending') ids.push(u.id);
  }
  tx.delete(outbox).where(inArray(outbox.id, ids)).run();
  return true;
}
