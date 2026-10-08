import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import { db } from '@/lib/db/client';
import { catchUp } from '@/lib/sync/catchup';
import { useUi } from '@/stores/ui';
import { activity, channelMembers, channels, messages } from '@/lib/db/schema';
import type { Channel, ID, Project, User } from '@/types/models';
import { useChannels, useMe, useProjects, useUsers } from '../shared';

/** Unread message count per channel for the signed-in user. */
export function useUnreadCounts(): Map<ID, number> {
  const me = useMe();
  const q = useLiveQuery(
    db
      .select({ channelId: messages.channelId, count: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(channelMembers, and(eq(channelMembers.channelId, messages.channelId), eq(channelMembers.userId, me.id)))
      .where(
        and(
          ne(messages.senderId, me.id),
          isNull(messages.deletedAt),
          isNull(messages.threadParentId),
          or(isNull(channelMembers.lastReadMessageId), sql`${messages.id} > ${channelMembers.lastReadMessageId}`),
        ),
      )
      .groupBy(messages.channelId),
    [me.id],
  );
  return useMemo(() => new Map(q.data.map((r) => [r.channelId, r.count])), [q.data]);
}

export function useUnreadActivityCount(): number {
  const q = useLiveQuery(db.select({ count: sql<number>`count(*)` }).from(activity).where(isNull(activity.readAt)));
  return q.data[0]?.count ?? 0;
}

const CHANNEL_ORDER = ['general', 'design', 'site-work', 'qs'];

export interface HomeProject {
  project: Project;
  channels: Channel[];
  unread: number;
}
export interface HomeDm {
  channel: Channel;
  peer: User;
  unread: number;
}

export function useHome() {
  const me = useMe();
  const projects = useProjects();
  const channelsQ = useChannels();
  const users = useUsers();
  const unread = useUnreadCounts();
  const dmMembers = useLiveQuery(
    db
      .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .where(eq(channels.kind, 'dm')),
  );

  return useMemo(() => {
    const list = channelsQ.list;
    const byProject: HomeProject[] = projects.list.map((project) => {
      const chs = list
        .filter((c) => c.projectId === project.id)
        .sort((a, b) => CHANNEL_ORDER.indexOf(a.name) - CHANNEL_ORDER.indexOf(b.name));
      return { project, channels: chs, unread: chs.reduce((n, c) => n + (unread.get(c.id) ?? 0), 0) };
    });
    const company = list.filter((c) => c.kind === 'company').sort((a) => (a.name === 'announcements' ? -1 : 1));
    const bot = list.find((c) => c.kind === 'bot') ?? null;
    const dms: HomeDm[] = [];
    for (const c of list.filter((x) => x.kind === 'dm')) {
      const peerId = dmMembers.data.find((m) => m.channelId === c.id && m.userId !== me.id)?.userId;
      const peer = peerId ? users.byId.get(peerId) : undefined;
      if (peer) dms.push({ channel: c, peer, unread: unread.get(c.id) ?? 0 });
    }
    dms.sort((a, b) => b.unread - a.unread || a.peer.name.localeCompare(b.peer.name));
    let total = 0;
    for (const n of unread.values()) total += n;
    return { projects: byProject, company, bot, dms, unread, totalUnread: total, loading: projects.loading };
  }, [projects.list, projects.loading, channelsQ.list, users.byId, unread, dmMembers.data, me.id]);
}

/** Company directory: not offline data, so it goes through TanStack Query. */
export function useDirectory() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api<{ users: User[] }>('GET', '/users')).users,
  });
}

/** Pull-to-refresh: runs a catch-up sync. */
export function useRefresh(): { refreshing: boolean; refresh: () => void; failed: boolean } {
  const [refreshing, setRefreshing] = useState(false);
  const failed = useUi((s) => s.syncFailed);
  const refresh = useCallback(() => {
    setRefreshing(true);
    void catchUp().finally(() => setRefreshing(false));
  }, []);
  return { refreshing, refresh, failed };
}
