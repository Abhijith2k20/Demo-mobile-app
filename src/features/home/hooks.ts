import { useMemo } from 'react';
import type { ChannelView, MessageView, ProjectView, UserView } from '@/types/models';
import { useChannels, useMe, useProjects, useUnreadCounts, useUsers } from '../shared';

export interface HomeProject {
  project: ProjectView;
  channels: ChannelView[];
  unread: number;
}
export interface HomeDm {
  channel: ChannelView;
  peer: UserView;
  unread: number;
}

export function useHome() {
  const me = useMe();
  const projects = useProjects();
  const channelsQ = useChannels();
  const users = useUsers();
  const unread = useUnreadCounts();

  return useMemo(() => {
    const list = channelsQ.list; // already in display order (the server sorts it)
    const byProject: HomeProject[] = projects.list.map((project) => {
      const chs = list.filter((c) => c.projectId === project.id);
      return { project, channels: chs, unread: chs.reduce((n, c) => n + c.unreadCount, 0) };
    });
    const company = list.filter((c) => c.kind === 'company');
    const bot = list.find((c) => c.kind === 'bot') ?? null;
    const dms: HomeDm[] = [];
    for (const c of list.filter((x) => x.kind === 'dm')) {
      const peer = c.peerId ? users.byId.get(c.peerId) : undefined;
      if (peer && peer.id !== me.id) dms.push({ channel: c, peer, unread: c.unreadCount });
    }
    let total = 0;
    for (const n of unread.values()) total += n;
    return {
      projects: byProject,
      company,
      bot,
      dms,
      unread,
      totalUnread: total,
      loading: projects.loading || channelsQ.loading,
      failed: projects.failed,
    };
  }, [projects.list, projects.loading, projects.failed, channelsQ.list, channelsQ.loading, users.byId, unread, me.id]);
}

export interface DmRow {
  channel: ChannelView;
  /** null for the Siteline Bot. */
  peer: UserView | null;
  unread: number;
  last: MessageView | null;
}

/** Direct messages for the DMs tab: the bot first, then people by most recent message. */
export function useDmList(): { rows: DmRow[]; totalUnread: number; loading: boolean } {
  const home = useHome();
  return useMemo(() => {
    // Latest conversation first: the server's order.
    const people: DmRow[] = home.dms.map((d) => ({ channel: d.channel, peer: d.peer, unread: d.unread, last: d.channel.lastMessage }));
    const bot: DmRow[] = home.bot ? [{ channel: home.bot, peer: null, unread: home.bot.unreadCount, last: home.bot.lastMessage }] : [];
    const rows = [...bot, ...people];
    return { rows, totalUnread: rows.reduce((n, r) => n + r.unread, 0), loading: home.loading };
  }, [home.dms, home.bot, home.loading]);
}
