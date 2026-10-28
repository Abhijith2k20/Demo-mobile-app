// Live updates: each server event marks the affected data stale, and the screens refetch it.
import { openEventStream } from '@/lib/api/transport';
import { runOutbox } from '@/lib/outbox';
import { keysFor, refresh, refreshAll } from '@/lib/queries';
import { useDemo } from '@/stores/demo';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import type { ServerEvent } from '@/types/models';

let close: (() => void) | null = null;
let wasConnected = false;
/** The first connect follows the screens' own first load, so only later reconnects refetch. */
let connectedBefore = false;

function summary(e: ServerEvent): string {
  switch (e.type) {
    case 'message.new':
    case 'message.updated':
    case 'message.deleted':
      return `${e.message.type} · ${(e.message.body ?? '').slice(0, 32)}`;
    case 'task.updated':
    case 'task.created':
      return `${e.task.name} · ${e.task.percent}%`;
    case 'project.updated':
      return e.project.name;
    case 'channel.updated':
      return `#${e.channel.name}`;
    case 'activity.new':
      return e.activity.text.slice(0, 40);
    case 'user.updated':
      return e.user.name;
    default:
      return '';
  }
}

function onEvent(e: ServerEvent): void {
  useDemo.getState().logEvent(e.type, summary(e));
  void refresh(...keysFor(e));
}

function onStatus(connected: boolean): void {
  useUi.getState().set({ socketConnected: connected });
  // Back after a gap: events may have been missed, so everything on screen is fetched again.
  if (connected && !wasConnected && connectedBefore) void refreshAll();
  if (connected) {
    connectedBefore = true;
    void runOutbox(); // back online: send what is waiting
  }
  wasConnected = connected;
}

export function connectSocket(): void {
  disconnectSocket();
  close = openEventStream(() => useSession.getState().accessToken, onEvent, onStatus);
}

export function disconnectSocket(): void {
  close?.();
  close = null;
  wasConnected = false;
  connectedBefore = false;
  useUi.getState().set({ socketConnected: false });
}
