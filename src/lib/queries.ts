// Server data in the app is a cache of API replies (TanStack Query). Nothing here decides
// anything: live events only say "this changed", and the affected queries are fetched again.
import type { QueryKey } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/queryClient';
import type { ServerEvent } from '@/types/models';

export const keys = {
  me: ['me'] as const,
  meta: ['meta'] as const,
  company: ['company'] as const,
  demoAccounts: ['demo-accounts'] as const,
  taskDefaults: (projectId: string, phase: string) => ['task-defaults', projectId, phase] as const,
  users: ['users'] as const,
  projects: ['projects'] as const,
  channels: ['channels'] as const,
  channel: (id: string) => ['channel', id] as const,
  browse: (projectId: string) => ['browse', projectId] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
  thread: (parentId: string) => ['thread', parentId] as const,
  pins: (channelId: string) => ['pins', channelId] as const,
  dm: (userId: string) => ['dm', userId] as const,
  /** Prefix for every filtered list of a project's tasks; the filters are the third part. */
  tasks: (projectId: string) => ['tasks', projectId] as const,
  task: (id: string) => ['task', id] as const,
  tasksByIds: (ids: string) => ['tasks-by-ids', ids] as const,
  myTasks: ['my-tasks'] as const,
  checkins: ['checkins'] as const,
  activity: ['activity'] as const,
  updates: (projectId: string) => ['updates', projectId] as const,
  files: (projectId: string) => ['files', projectId] as const,
};

/** Fetcher for a GET path. */
export const get =
  <T,>(path: string) =>
  () =>
    api<T>('GET', path);

export function refresh(...list: QueryKey[]): Promise<void> {
  return Promise.all(list.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}

/** Pull-to-refresh, reconnect and app foreground: fetch everything on screen again. */
export function refreshAll(): Promise<void> {
  return queryClient.invalidateQueries();
}

/** Which cached data a live event makes stale. */
export function keysFor(e: ServerEvent): QueryKey[] {
  switch (e.type) {
    case 'message.new':
    case 'message.updated':
    case 'message.deleted': {
      const m = e.message;
      return [
        keys.messages(m.channelId),
        keys.channels,
        keys.channel(m.channelId),
        keys.thread(m.threadParentId ?? m.id),
        keys.pins(m.channelId),
        ['updates'],
        ['files'],
      ];
    }
    case 'task.created':
    case 'task.updated':
      return [keys.tasks(e.task.projectId), keys.task(e.task.id), ['tasks-by-ids'], keys.myTasks];
    case 'project.updated':
    case 'project.deleted':
      return [keys.projects, keys.me, keys.channels, ['browse'], ['tasks'], keys.myTasks];
    case 'channel.updated':
    case 'channel.deleted':
    case 'channel.member_added':
    case 'channel.member_removed':
      return [keys.channels, ['channel'], ['browse'], ['messages']];
    case 'channel.read':
      return [keys.channels, keys.channel(e.channelId)];
    case 'checkin.new':
      return [keys.checkins];
    case 'activity.new':
    case 'activity.read':
      return [keys.activity];
    case 'user.updated':
      return [keys.users, keys.me];
  }
}
