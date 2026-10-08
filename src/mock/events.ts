// Event bus that emulates the WebSocket: subscribe per user, publish after "commit".
import type { ID, ServerEvent } from '@/types/models';

type Listener = (event: ServerEvent) => void;
type StatusListener = (connected: boolean) => void;

const subs = new Map<ID, Set<Listener>>();
const statusListeners = new Set<StatusListener>();
let connected = true;

export function subscribe(userId: ID, fn: Listener): () => void {
  const set = subs.get(userId) ?? new Set<Listener>();
  set.add(fn);
  subs.set(userId, set);
  return () => {
    set.delete(fn);
  };
}

/** Deliver to the given users only (the caller decides who may see the resource). */
export function publish(event: ServerEvent, userIds: ID[]): void {
  if (!connected) return; // a dropped socket misses events; the client catches up via /sync
  const targets = [...new Set(userIds)];
  // Events cross a "wire": snapshot now so later server-side changes don't leak in.
  const snapshot = JSON.parse(JSON.stringify(event)) as ServerEvent;
  setTimeout(() => {
    if (!connected) return;
    for (const id of targets) {
      for (const fn of subs.get(id) ?? []) {
        try {
          fn(snapshot);
        } catch (e) {
          console.warn('[mock events] listener failed', e);
        }
      }
    }
  }, 40);
}

export function isConnected(): boolean {
  return connected;
}

export function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  for (const fn of statusListeners) fn(value);
}

export function onStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}
