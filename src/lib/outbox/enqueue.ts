import { uuidv7 } from 'uuidv7';
import { db, type Tx } from '@/lib/db/client';
import { outbox } from '@/lib/db/schema';
import type { ID, OutboxKind } from '@/types/models';
import type { Payloads } from './types';

type Listener = () => void;
const listeners = new Set<Listener>();

/** The runner subscribes here; avoids a circular import between enqueue and runner. */
export function onKick(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function kick(): void {
  for (const fn of listeners) fn();
}

/**
 * Rule 1 — one transaction: the local change and its outbox row are saved together, so a
 * crash can never leave one without the other. Wakes the runner afterwards.
 */
export function write(fn: (tx: Tx) => void): void {
  db.transaction(fn);
  kick();
}

export function enqueue<K extends OutboxKind>(
  tx: Tx,
  kind: K,
  lane: string,
  entityId: ID,
  payload: Payloads[K],
  dependsOn: ID | null = null,
): ID {
  const id = uuidv7();
  tx.insert(outbox)
    .values({
      id,
      kind,
      lane,
      entityId,
      payload: JSON.stringify(payload),
      dependsOn,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastErrorCode: null,
      createdAt: Date.now(),
    })
    .run();
  return id;
}
