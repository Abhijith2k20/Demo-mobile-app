import { isCompanyAdmin } from '@/shared/permissions';
import type { ID, Message, SyncResponse } from '@/types/models';
import { canSeeChannel, ensureChannelMember, nowIso, store } from '../db';
import { route, type RouteDef } from '../http';
import { publicUser } from './auth';
import { publicCheckin } from './misc';

const FIRST_SYNC_MESSAGES = 50;
const PAGE_SIZE = 250;

export const syncRoutes: RouteDef[] = [
  route('GET', '/sync', ({ user, query }): SyncResponse => {
    const s = store();
    const serverTime = nowIso();
    const since = query.since || null;
    const cursor = Number(query.cursor) || 0;
    const admin = isCompanyAdmin(user);
    const newer = (ts: string) => !since || ts > since;

    const myProjects = new Map(s.projectMembers.filter((m) => m.userId === user.id).map((m) => [m.projectId, m]));
    const projects = [...s.projects.values()].filter((p) => admin || myProjects.has(p.id));
    const projectIds = new Set(projects.map((p) => p.id));
    const joinedProject = (id: ID) => !since || (myProjects.get(id)?.joinedAt ?? '') > since;

    const channels = [...s.channels.values()].filter((c) => canSeeChannel(user, c));
    // Admins see every project/company channel; give them a row so read markers work.
    for (const c of channels) if (c.kind !== 'dm' && c.kind !== 'bot') ensureChannelMember(user.id, c.id);
    const channelIds = new Set(channels.map((c) => c.id));
    const myChannelRows = new Map(s.channelMembers.filter((m) => m.userId === user.id).map((m) => [m.channelId, m]));
    const joinedChannel = (id: ID) => !since || (myChannelRows.get(id)?.joinedAt ?? '') > since;

    // Messages: latest 50 per channel on first sight of a channel, otherwise changes since.
    const perChannel = new Map<ID, Message[]>();
    for (const m of s.messages.values()) {
      if (!channelIds.has(m.channelId)) continue;
      const list = perChannel.get(m.channelId) ?? [];
      list.push(m);
      perChannel.set(m.channelId, list);
    }
    let messages: Message[] = [];
    for (const [channelId, list] of perChannel) {
      if (joinedChannel(channelId)) {
        list.sort((a, b) => (a.id < b.id ? 1 : -1));
        messages.push(...list.slice(0, FIRST_SYNC_MESSAGES));
      } else {
        messages.push(...list.filter((m) => newer(m.updatedAt)));
      }
    }
    messages.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1));
    const hasMore = messages.length > cursor + PAGE_SIZE;
    messages = messages.slice(cursor, cursor + PAGE_SIZE);

    const empty: SyncResponse = {
      serverTime,
      users: [],
      projects: [],
      projectMembers: [],
      channels: [],
      channelMembers: [],
      messages,
      tasks: [],
      taskHistory: [],
      checkins: [],
      activities: [],
      removed: { projects: [], channels: [], tasks: [], messages: [] },
      hasMore,
      cursor: hasMore ? cursor + PAGE_SIZE : null,
    };
    if (cursor > 0) return empty; // later pages only carry messages

    const tasks = [...s.tasks.values()].filter(
      (t) => projectIds.has(t.projectId) && (joinedProject(t.projectId) || newer(t.updatedAt)),
    );
    const taskProject = new Map([...s.tasks.values()].map((t) => [t.id, t.projectId]));
    const removed = empty.removed;
    if (since) {
      for (const r of s.removals) {
        if (r.userId !== user.id || r.at <= since) continue;
        // Skip tombstones for things the user can see again (removed, then re-added).
        if (r.kind === 'projects' && projectIds.has(r.id)) continue;
        if (r.kind === 'channels' && channelIds.has(r.id)) continue;
        if (r.kind === 'tasks' && projectIds.has(taskProject.get(r.id) ?? '')) continue;
        if (!removed[r.kind].includes(r.id)) removed[r.kind].push(r.id);
      }
    }

    return {
      ...empty,
      users: [...s.users.values()].filter((u) => newer(u.updatedAt)).map(publicUser),
      projects: projects.filter((p) => joinedProject(p.id) || newer(p.updatedAt)),
      // Memberships are small, so they are always sent in full for what the user can see.
      projectMembers: s.projectMembers
        .filter((m) => projectIds.has(m.projectId))
        .map(({ joinedAt: _j, ...m }) => m),
      channels: channels.filter((c) => joinedChannel(c.id) || newer(c.updatedAt)),
      channelMembers: s.channelMembers
        .filter((m) => channelIds.has(m.channelId))
        .map(({ joinedAt: _j, ...m }) => m),
      tasks,
      taskHistory: s.taskHistory.filter((h) => {
        const pid = taskProject.get(h.taskId);
        return !!pid && projectIds.has(pid) && (joinedProject(pid) || newer(h.createdAt));
      }),
      checkins: [...s.checkins.values()]
        .filter((c) => c.userId === user.id && newer(c.updatedAt))
        .map(publicCheckin),
      activities: s.activities.filter((a) => a.userId === user.id && newer(a.createdAt)).slice(-60),
      removed,
    };
  }),
];
