// Catch-up sync: on login, app foreground, reconnect and pull-to-refresh.
import { api, isAppError } from '@/lib/api/client';
import { kvGet, kvSet } from '@/lib/db/init';
import { sqlite } from '@/lib/db/client';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import type { SyncResponse } from '@/types/models';
import { applyIncoming } from './applyIncoming';

const OVERLAP_MS = 2 * 60 * 1000;
const KEY = 'lastSyncTime';

let inflight: Promise<boolean> | null = null;
let queued = false;
let queuedFull = false;

async function runOnce(full: boolean): Promise<void> {
  // A reply that arrives after logout or a user switch belongs to someone else: drop it.
  const userId = useSession.getState().user?.id;
  if (!userId) return;
  const last = full ? null : kvGet(KEY);
  // Ask for a little more than we need: clocks and commit order are never perfectly aligned.
  const since = last ? new Date(Date.parse(last) - OVERLAP_MS).toISOString() : null;
  let cursor = 0;
  let serverTime: string | null = null;
  for (;;) {
    const qs = `cursor=${cursor}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
    const res = await api<SyncResponse>('GET', `/sync?${qs}`);
    if (useSession.getState().user?.id !== userId) return;
    if (cursor === 0) {
      serverTime = res.serverTime;
      applyIncoming({ ...res, fullSnapshot: since === null });
    } else {
      applyIncoming({ messages: res.messages });
    }
    if (!res.hasMore || res.cursor === null) break;
    cursor = res.cursor;
  }
  if (serverTime) {
    kvSet(KEY, serverTime);
    useUi.getState().set({ lastSyncAt: serverTime });
  }
}

/** Resolves true when the sync finished, false when it could not (e.g. offline). Never throws. */
export function catchUp(opts: { full?: boolean } = {}): Promise<boolean> {
  if (inflight) {
    queued = true;
    // Remember that someone needs everything reloaded; the next pass honours it.
    queuedFull = queuedFull || !!opts.full;
    return inflight;
  }
  useUi.getState().set({ syncing: true });
  inflight = (async () => {
    try {
      let full = !!opts.full;
      do {
        queued = false;
        queuedFull = false;
        await runOnce(full);
        full = queuedFull;
      } while (queued);
      useUi.getState().set({ syncFailed: false });
      return true;
    } catch (e) {
      if (!isAppError(e)) console.warn('[sync] failed', e);
      useUi.getState().set({ syncFailed: !(isAppError(e) && e.kind === 'offline') });
      return false;
    } finally {
      inflight = null;
      useUi.getState().set({ syncing: false });
      useSession.getState().setReady(true);
    }
  })();
  return inflight;
}

/** Demo panel: forget everything synced (the outbox survives) and fetch it all again. */
export function wipeSyncedAndResync(): Promise<boolean> {
  sqlite.withTransactionSync(() => {
    for (const t of ['users', 'projects', 'project_members', 'channels', 'channel_members', 'tasks', 'task_history', 'checkins', 'activity']) {
      sqlite.execSync(`DELETE FROM ${t} WHERE 1;`); // WHERE 1 keeps the change hook firing
    }
    // Keep messages that are still waiting to be sent.
    sqlite.execSync(`DELETE FROM messages WHERE status = 'sent';`);
    sqlite.execSync(`DELETE FROM kv WHERE key = '${KEY}';`);
  });
  useUi.getState().set({ lastSyncAt: null });
  return catchUp({ full: true });
}
