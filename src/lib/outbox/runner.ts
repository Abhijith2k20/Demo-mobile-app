// The outbox runner. One run at a time; one request at a time, plus a separate slot for uploads.
import { asc, eq, inArray } from 'drizzle-orm';
import { AppState } from 'react-native';
import { AppError, isAppError } from '@/lib/api/client';
import { isOnline } from '@/lib/api/transport';
import { db } from '@/lib/db/client';
import { outbox } from '@/lib/db/schema';
import { useSession } from '@/stores/session';
import type { ID, OutboxItem, OutboxKind } from '@/types/models';
import { backoffMs, classify } from './classify';
import { onKick } from './enqueue';
import { DROP_ON_FAILURE, handlers } from './handlers';
import { pickNext, type Slot } from './lanes';
import { readPayload, type Handler } from './types';

const TICK_MS = 10_000;

let running = false;
let rerun = false;
let halted = false; // set when a request reports "offline": stop until the network is back
let started = false;
let wake: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void)[] = [];

function load(): OutboxItem[] {
  return db.select().from(outbox).orderBy(asc(outbox.createdAt), asc(outbox.id)).all();
}

function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  console.warn('[outbox] unexpected error', e);
  return new AppError('server', 'UNKNOWN', e instanceof Error ? e.message : 'Unknown', {}, '');
}

/** Marks an item failed, rolls back its local change, and fails everything that depended on it. */
function failItem<K extends OutboxKind>(item: OutboxItem, error: AppError): void {
  const handler = handlers[item.kind] as unknown as Handler<K>;
  if (DROP_ON_FAILURE.includes(item.kind)) {
    db.delete(outbox).where(eq(outbox.id, item.id)).run();
  } else {
    db.update(outbox).set({ status: 'failed', lastErrorCode: error.code }).where(eq(outbox.id, item.id)).run();
  }
  try {
    handler.onPermanentFailure?.(readPayload<K>(item), item, error);
  } catch (e) {
    console.warn('[outbox] rollback failed', e);
  }
  const dependents = db.select().from(outbox).where(eq(outbox.dependsOn, item.id)).all();
  for (const d of dependents) {
    if (d.status === 'failed') continue;
    failItem(d, new AppError('validation', 'DEPENDENCY_FAILED', 'A file this depends on could not be sent', {}, error.requestId));
  }
}

async function processItem<K extends OutboxKind>(item: OutboxItem): Promise<void> {
  const handler = handlers[item.kind] as unknown as Handler<K>;
  const userId = useSession.getState().user?.id;
  db.update(outbox).set({ status: 'sending' }).where(eq(outbox.id, item.id)).run();
  try {
    const applyReply = await handler.send(readPayload<K>(item), item);
    // The user logged out or switched while this was in flight: the local data is no longer theirs.
    if (useSession.getState().user?.id !== userId) return;
    // Remove the item first so the server's reply is not overwritten by re-applying it (rule 6).
    db.delete(outbox).where(eq(outbox.id, item.id)).run();
    applyReply?.();
  } catch (e) {
    if (useSession.getState().user?.id !== userId) return;
    const error = toAppError(e);
    const stillThere = db.select().from(outbox).where(eq(outbox.id, item.id)).get();
    if (!stillThere) return; // discarded or wiped while in flight
    switch (classify(error)) {
      case 'offline':
        halted = true;
        db.update(outbox).set({ status: 'pending', lastErrorCode: error.code }).where(eq(outbox.id, item.id)).run();
        break;
      case 'auth':
        // The session is gone (refresh already failed); the app is returning to login.
        halted = true;
        db.update(outbox).set({ status: 'pending', lastErrorCode: error.code }).where(eq(outbox.id, item.id)).run();
        break;
      case 'temporary': {
        const attempts = item.attempts + 1;
        db.update(outbox)
          .set({ status: 'pending', attempts, nextAttemptAt: Date.now() + backoffMs(attempts), lastErrorCode: error.code })
          .where(eq(outbox.id, item.id))
          .run();
        break;
      }
      case 'permanent':
        failItem(item, error);
        break;
    }
  }
}

async function worker(slot: Slot): Promise<number> {
  let done = 0;
  while (!halted && useSession.getState().user) {
    const next = pickNext(load(), slot, Date.now());
    if (!next) break;
    await processItem(next);
    done++;
  }
  return done;
}

function scheduleWake(): void {
  if (wake) clearTimeout(wake);
  wake = null;
  const waiting = load().filter((i) => i.status === 'pending');
  if (waiting.length === 0) return;
  const soonest = Math.min(...waiting.map((i) => i.nextAttemptAt));
  wake = setTimeout(() => void runOutbox(), Math.max(250, soonest - Date.now()));
}

/** Safe to call at any time and from anywhere; overlapping calls collapse into one run. */
export async function runOutbox(): Promise<void> {
  if (!started || !useSession.getState().user) return;
  if (running) {
    rerun = true;
    return;
  }
  if (!isOnline()) return;
  running = true;
  halted = false;
  try {
    let progressed: number;
    do {
      rerun = false;
      // The upload slot runs alongside the main slot, so a big photo never blocks a text.
      const counts = await Promise.all([worker('main'), worker('upload')]);
      progressed = counts[0] + counts[1];
    } while (!halted && (progressed > 0 || rerun));
  } finally {
    running = false;
    scheduleWake();
  }
}

/** Demo panel "Run now": ignore backoff timers once. */
export function runOutboxNow(): void {
  db.update(outbox).set({ nextAttemptAt: 0 }).where(eq(outbox.status, 'pending')).run();
  void runOutbox();
}

export function retryItems(ids: ID[]): void {
  if (ids.length === 0) return;
  db.update(outbox)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: 0, lastErrorCode: null })
    .where(inArray(outbox.id, ids))
    .run();
  void runOutbox();
}

export function startOutbox(): void {
  if (started) return;
  started = true;
  unsubscribe = [
    onKick(() => void runOutbox()),
    (() => {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void runOutbox();
      });
      return () => sub.remove();
    })(),
  ];
  interval = setInterval(() => void runOutbox(), TICK_MS);
  void runOutbox();
}

export function stopOutbox(): void {
  started = false;
  for (const off of unsubscribe) off();
  unsubscribe = [];
  if (interval) clearInterval(interval);
  if (wake) clearTimeout(wake);
  interval = null;
  wake = null;
}
