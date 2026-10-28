// Send queue for the things people do in the field with bad signal: messages (with photos), check-in
// answers and task updates. Each change is saved on the phone first and sent in the background,
// oldest first, until the server accepts or refuses it. The server still decides everything:
// the app only shows "sending" until it answers. Everything else in the app is online-only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuidv7 } from 'uuidv7';
import { create } from 'zustand';
import { api, isAppError, type AppError } from '@/lib/api/client';
import { photoForm } from '@/lib/api/transport';
import { errorText } from '@/lib/i18n';
import { keys, refresh } from '@/lib/queries';
import { dropPhoto, keepPhoto, photoExists } from '@/lib/queuedFiles';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/ui';
import type { Attachment, CheckinAnswer, ID, MessageType, Task } from '@/types/models';

export type TaskChanges = Partial<Pick<Task, 'name' | 'description' | 'phase' | 'ownerId' | 'plannedStart' | 'plannedFinish' | 'status' | 'percent'>>;

export interface QueuedPhoto {
  attachmentId: ID;
  /** File on the phone. */
  uri: string;
  /** Set once uploaded, so a retry never uploads it again. */
  uploadId?: ID;
  url?: string;
}

interface Base {
  /** For messages this is also the message id the server will use. */
  id: ID;
  userId: ID;
  createdAt: string;
  state: 'waiting' | 'sending' | 'failed';
  attempts: number;
  /** Epoch ms of the next try (waiting items). */
  nextAt: number;
  /** Error code of the last failure. */
  error: string | null;
}
export type OutboxItem = Base &
  (
    | {
        kind: 'message';
        channelId: ID;
        type: MessageType;
        body: string | null;
        data: Record<string, unknown> | null;
        threadParentId: ID | null;
        photos: QueuedPhoto[];
      }
    | { kind: 'checkin'; checkinId: ID; taskId: ID; taskName: string; answer: CheckinAnswer }
    | { kind: 'task'; taskId: ID; projectId: ID; taskName: string; changes: TaskChanges }
  );

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What a caller supplies; the queue fills in the rest. */
export type NewItem = DistributiveOmit<OutboxItem, keyof Base> & { id?: ID };

/** Waits after a temporary failure: 2 s, 5 s, 10 s, then every 20 s. */
export const BACKOFF_MS = [2000, 5000, 10000, 20000];
const TEMPORARY = new Set(['offline', 'timeout', 'server', 'rate_limited']);
/** A server error this many times in a row is a bug, not bad signal: stop blocking the queue. */
export const MAX_SERVER_ERRORS = 5;

export const storageKey = (userId: ID) => `siteline.outbox.${userId}`;

interface OutboxState {
  items: OutboxItem[];
  set: (items: OutboxItem[]) => void;
}
export const useOutbox = create<OutboxState>((set) => ({ items: [], set: (items) => set({ items }) }));

function save(items: OutboxItem[]): void {
  useOutbox.getState().set(items);
  const userId = useSession.getState().user?.id;
  if (userId) {
    AsyncStorage.setItem(storageKey(userId), JSON.stringify(items.filter((i) => i.userId === userId))).catch((e) =>
      console.warn('[outbox] could not save', e),
    );
  }
}

const update = (id: ID, patch: Partial<Base> & Record<string, unknown>) =>
  save(useOutbox.getState().items.map((i) => (i.id === id ? ({ ...i, ...patch } as OutboxItem) : i)));

/** Loads the signed-in person's queue (after sign-in or app start). Items "sending" when the app closed are tried again. */
export async function loadOutbox(userId: ID): Promise<void> {
  let items: OutboxItem[] = [];
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch (e) {
    console.warn('[outbox] could not load', e);
  }
  useOutbox.getState().set(items.map((i) => (i.state === 'sending' ? { ...i, state: 'waiting' } : i)));
  void runOutbox();
}

/** Forgets the queue on this phone (log out after the warning, or demo reset). */
export async function clearOutbox(userId?: ID): Promise<void> {
  useOutbox.getState().set([]);
  if (userId) await AsyncStorage.removeItem(storageKey(userId)).catch(() => {});
}

/** Adds a change and starts sending. Two waiting updates to one task merge into one. */
export function enqueue(input: NewItem): ID {
  const userId = useSession.getState().user?.id;
  if (!userId) throw new Error('No session');
  const items = useOutbox.getState().items;
  if (input.kind === 'task') {
    const same = items.find((i) => i.kind === 'task' && i.taskId === input.taskId && i.state === 'waiting');
    if (same && same.kind === 'task') {
      update(same.id, { changes: { ...same.changes, ...input.changes } });
      void runOutbox();
      return same.id;
    }
  }
  const { id, ...rest } = input;
  if (rest.kind === 'message') rest.photos = rest.photos.map((p) => ({ ...p, uri: keepPhoto(p.uri, p.attachmentId) }));
  const item = { ...rest, id: id ?? uuidv7(), userId, createdAt: new Date().toISOString(), state: 'waiting', attempts: 0, nextAt: 0, error: null } as OutboxItem;
  save([...items, item]);
  void runOutbox();
  return item.id;
}

/** Changes still to reach the server for the signed-in person. */
export function useUnsentCount(): { waiting: number; failed: number } {
  const me = useSession((st) => st.user?.id);
  const items = useOutbox((st) => st.items);
  const mine = items.filter((i) => i.userId === me);
  return { waiting: mine.filter((i) => i.state !== 'failed').length, failed: mine.filter((i) => i.state === 'failed').length };
}

export function retryItem(id: ID): void {
  update(id, { state: 'waiting', nextAt: 0, error: null });
  void runOutbox();
}

export function discardItem(id: ID): void {
  const item = useOutbox.getState().items.find((i) => i.id === id);
  if (item?.kind === 'message') item.photos.forEach((p) => dropPhoto(p.uri));
  save(useOutbox.getState().items.filter((i) => i.id !== id));
}

/** "Send now": try every waiting item immediately. */
export function sendNow(): void {
  save(useOutbox.getState().items.map((i) => (i.state === 'waiting' ? { ...i, nextAt: 0 } : i)));
  void runOutbox();
}

// ---- Sending ----

/** A queued photo is gone from the phone: the message can't be sent as written. */
class MissingPhoto extends Error {}

async function send(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'message': {
      const photos = [...item.photos];
      for (let n = 0; n < photos.length; n++) {
        if (photos[n].uploadId) continue;
        if (!photoExists(photos[n].uri)) throw new MissingPhoto();
        const res = await api<{ uploadId: ID; url: string }>('POST', '/uploads', undefined, photoForm(photos[n].uri));
        photos[n] = { ...photos[n], uploadId: res.uploadId, url: res.url };
        update(item.id, { photos }); // remembered even if the message itself fails next
      }
      const attachments: Attachment[] = photos.map((p) => ({ id: p.attachmentId, kind: 'image', uri: p.url ?? null, uploadId: p.uploadId ?? null }));
      const data = attachments.length ? { ...(item.data ?? {}), attachments } : item.data;
      await api('POST', `/channels/${item.channelId}/messages`, {
        id: item.id,
        type: item.type,
        body: item.body,
        data,
        threadParentId: item.threadParentId,
      });
      return void refresh(keys.messages(item.channelId), keys.channels, keys.channel(item.channelId), ...(item.threadParentId ? [keys.thread(item.threadParentId)] : []));
    }
    case 'checkin':
      await api('POST', `/checkins/${item.checkinId}/answer`, item.answer);
      return void refresh(keys.checkins, keys.task(item.taskId), keys.myTasks, ['tasks']);
    case 'task':
      await api('PATCH', `/tasks/${item.taskId}`, item.changes);
      return void refresh(keys.task(item.taskId), keys.tasks(item.projectId), keys.myTasks, ['tasks-by-ids'], keys.projects);
  }
}

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Sends waiting items oldest first. A network problem pauses the whole queue so order is kept. */
export async function runOutbox(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const me = useSession.getState().user?.id;
      const next = useOutbox.getState().items.find((i) => i.userId === me && i.state === 'waiting');
      if (!me || !next) break;
      if (next.nextAt > Date.now()) {
        schedule(next.nextAt - Date.now());
        break;
      }
      update(next.id, { state: 'sending' });
      try {
        await send(next);
        discardItem(next.id);
      } catch (e) {
        const err: AppError | null = isAppError(e) ? e : null;
        const attempts = next.attempts + 1;
        if (e instanceof MissingPhoto) {
          update(next.id, { state: 'failed', attempts, error: 'DEPENDENCY_FAILED' });
          toast(errorText('DEPENDENCY_FAILED'), 'danger');
          continue;
        }
        const stuck = err?.kind === 'server' && attempts >= MAX_SERVER_ERRORS;
        if ((!err || TEMPORARY.has(err.kind)) && !stuck) {
          const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          update(next.id, { state: 'waiting', attempts, nextAt: Date.now() + wait, error: err?.code ?? 'UNKNOWN' });
          schedule(wait);
          break; // the network is the problem: later items would fail too, and must not overtake this one
        }
        if (err.kind === 'auth') {
          update(next.id, { state: 'waiting', attempts, error: err.code }); // kept for the next sign-in
          break;
        }
        // The server said no for good: show why and move on to the next item.
        update(next.id, { state: 'failed', attempts, error: err.code });
        toast(errorText(err), 'danger');
      }
    }
  } finally {
    running = false;
  }
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runOutbox();
  }, ms);
}

