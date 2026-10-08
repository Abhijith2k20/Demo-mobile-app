// Live updates. Subscribes to the mock event bus now; a WebSocket later (see transport.ts).
import { onConnectivity, openEventStream } from '@/lib/api/transport';
import { runOutbox } from '@/lib/outbox/runner';
import { applyIncoming } from '@/lib/sync/applyIncoming';
import { catchUp } from '@/lib/sync/catchup';
import { queryClient } from '@/lib/queryClient';
import { useDemo } from '@/stores/demo';
import { useUi } from '@/stores/ui';
import type { ID, ServerEvent } from '@/types/models';

let close: (() => void) | null = null;
let wasConnected = false;

function summarise(e: ServerEvent): string {
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
    case 'channel.member_added':
    case 'channel.member_removed':
      return `channel ${e.channelId.slice(-6)}`;
    case 'checkin.new':
      return e.checkin.answer ? 'answered' : 'asked';
    case 'activity.new':
      return e.activity.text.slice(0, 40);
  }
}

function onEvent(e: ServerEvent): void {
  useDemo.getState().logEvent(e.type, summarise(e));
  switch (e.type) {
    case 'message.new':
    case 'message.updated':
    case 'message.deleted':
      applyIncoming({ messages: [e.message] });
      break;
    case 'task.updated':
    case 'task.created':
      applyIncoming({ tasks: [e.task], taskHistory: e.history });
      break;
    case 'project.updated':
      applyIncoming({ projects: [e.project] });
      // Membership may have changed with it; the snapshot comes from a catch-up.
      void catchUp();
      break;
    case 'channel.updated':
      applyIncoming({ channels: [e.channel] });
      break;
    case 'channel.member_added':
    case 'channel.member_removed':
      // Access changed: let sync bring (or remove) the channel and its history.
      void catchUp();
      break;
    case 'checkin.new':
      applyIncoming({ checkins: [e.checkin] });
      break;
    case 'activity.new':
      applyIncoming({ activities: [e.activity] });
      break;
  }
  if (e.type !== 'activity.new') void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

function onStatus(connected: boolean): void {
  useUi.getState().set({ socketConnected: connected });
  if (connected && !wasConnected && close) {
    // Reconnected: we may have missed events while away.
    void catchUp().then(() => runOutbox());
  }
  wasConnected = connected;
}

export function connectSocket(userId: ID): void {
  disconnectSocket();
  wasConnected = true; // the first "connected" is not a reconnect; login runs its own sync
  const offStream = openEventStream(userId, onEvent, onStatus);
  const offNet = onConnectivity((online) => {
    useUi.getState().set({ online });
    if (online) void runOutbox();
  });
  close = () => {
    offStream();
    offNet();
  };
}

export function disconnectSocket(): void {
  close?.();
  close = null;
  useUi.getState().set({ socketConnected: false });
}
