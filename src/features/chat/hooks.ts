import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { db } from '@/lib/db/client';
import { channelMembers, channels, messages, projectMembers, users } from '@/lib/db/schema';
import { canPost } from '@/shared/permissions';
import type { Channel, ID, JobTitle, Message, User } from '@/types/models';
import { shortProjectName, useMe, useProject } from '../shared';
import { discardEmptyDm, fetchOlderMessages, markRead, openDm } from './api';

export interface ChannelInfo {
  channel: Channel | null;
  loading: boolean;
  title: string;
  subtitle: string;
  members: User[];
  /** The other person in a DM. */
  peer: User | null;
  isBot: boolean;
  canPost: boolean;
  projectName: string | null;
  jobTitles: Map<ID, JobTitle>;
}

export function useChannelInfo(channelId: ID): ChannelInfo {
  const me = useMe();
  const { t } = useTranslation();
  const ch = useLiveQuery(db.select().from(channels).where(eq(channels.id, channelId)), [channelId]);
  const channel = ch.data[0] ?? null;
  const project = useProject(channel?.projectId);
  const memberRows = useLiveQuery(
    db
      .select({ user: users })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(asc(users.name)),
    [channelId],
  );
  const pm = useLiveQuery(db.select().from(projectMembers).where(eq(projectMembers.projectId, channel?.projectId ?? '')), [
    channel?.projectId,
  ]);
  return useMemo(() => {
    const all = memberRows.data.map((r) => r.user);
    // Owner/Admin can read every project channel but are not listed as project members.
    const members = channel?.kind === 'project' ? all.filter((u) => pm.data.some((m) => m.userId === u.id)) : all;
    const peer = channel?.kind === 'dm' ? (all.find((u) => u.id !== me.id) ?? null) : null;
    const isBot = channel?.kind === 'bot';
    const projectName = project ? shortProjectName(project.name) : null;
    const title = isBot ? 'Siteline Bot' : channel?.kind === 'dm' ? (peer?.name ?? '') : channel ? `# ${channel.name}` : '';
    const count = t('channel.members', '{{count}} members', { count: members.length });
    const subtitle = isBot
      ? t('channel.botSubtitle', 'Check-ins and reminders')
      : channel?.kind === 'dm'
        ? peer?.online
          ? t('channel.online', 'Online')
          : t('channel.dm', 'Direct message')
        : projectName
          ? `${projectName} · ${count}`
          : `${t('home.company', 'Company')} · ${count}`;
    return {
      channel,
      loading: !ch.updatedAt,
      title,
      subtitle,
      members,
      peer,
      isBot,
      canPost: !!channel && !isBot && canPost(me, channel),
      projectName,
      jobTitles: new Map(pm.data.map((m) => [m.userId, m.jobTitle])),
    };
  }, [channel, ch.updatedAt, memberRows.data, pm.data, project, me, t]);
}

export type ListItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'new'; key: string }
  | { kind: 'message'; key: string; message: Message; grouped: boolean; replies: number; lastReplyAt: string | null };

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const GROUPABLE = new Set(['text', 'image', 'voice', 'file']);

export function dayLabel(iso: string, today: string, yesterday: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return today;
  if (isYesterday(d)) return yesterday;
  return format(d, 'EEE d MMM');
}

function buildItems(
  list: Message[],
  replyInfo: Map<ID, { count: number; last: string }>,
  newAfter: ID | null | undefined,
  meId: ID,
  labels: { today: string; yesterday: string },
): ListItem[] {
  const items: ListItem[] = [];
  let prev: Message | null = null;
  let newShown = newAfter === undefined; // undefined = don't show a divider at all
  for (const m of list) {
    const day = m.createdAt.slice(0, 10);
    const localDay = format(parseISO(m.createdAt), 'yyyy-MM-dd');
    const prevDay = prev ? format(parseISO(prev.createdAt), 'yyyy-MM-dd') : null;
    let brokeGroup = false;
    if (localDay !== prevDay) {
      items.push({ kind: 'day', key: `day-${localDay}-${day}`, label: dayLabel(m.createdAt, labels.today, labels.yesterday) });
      brokeGroup = true;
    }
    if (!newShown && m.senderId !== meId && (newAfter === null || m.id > (newAfter as ID))) {
      // Only worth a divider when something older is on screen above it.
      if (prev) items.push({ kind: 'new', key: 'new-divider' });
      newShown = true;
      brokeGroup = true;
    }
    const grouped =
      !brokeGroup &&
      !!prev &&
      prev.senderId === m.senderId &&
      GROUPABLE.has(m.type) &&
      GROUPABLE.has(prev.type) &&
      !prev.deletedAt &&
      Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
    const info = replyInfo.get(m.id);
    items.push({ kind: 'message', key: m.id, message: m, grouped, replies: info?.count ?? 0, lastReplyAt: info?.last ?? null });
    prev = m;
  }
  return items;
}

const PAGE = 50;

export function useChannelMessages(channelId: ID) {
  const me = useMe();
  const { t } = useTranslation();
  const [limit, setLimit] = useState(PAGE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [serverHasMore, setServerHasMore] = useState(true);

  const q = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          or(isNull(messages.threadParentId), sql`json_extract(${messages.data}, '$.alsoToChannel') = 1`),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit),
    [channelId, limit],
  );
  const replies = useLiveQuery(
    db
      .select({
        parentId: messages.threadParentId,
        count: sql<number>`count(*)`,
        last: sql<string>`max(${messages.createdAt})`,
      })
      .from(messages)
      .where(and(eq(messages.channelId, channelId), isNotNull(messages.threadParentId), isNull(messages.deletedAt)))
      .groupBy(messages.threadParentId),
    [channelId],
  );
  const myRow = useLiveQuery(
    db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, me.id))),
    [channelId, me.id],
  );

  // Remember where "new" started when the screen opened, so the divider stays put while reading.
  // undefined = no divider; null = everything is new.
  const [newAfter, setNewAfter] = useState<{ value: ID | null | undefined } | null>(null);
  if (!newAfter && myRow.updatedAt && q.updatedAt) {
    const marker = myRow.data[0]?.lastReadMessageId ?? null;
    const hasUnread = q.data.some((m) => m.senderId !== me.id && (marker === null || m.id > marker));
    setNewAfter({ value: hasUnread ? marker : undefined });
  }

  const ordered = useMemo(() => [...q.data].reverse(), [q.data]);
  const items = useMemo(() => {
    const info = new Map<ID, { count: number; last: string }>();
    for (const r of replies.data) if (r.parentId) info.set(r.parentId, { count: r.count, last: r.last });
    return buildItems(ordered, info, newAfter?.value, me.id, {
      today: t('common.today', 'Today'),
      yesterday: t('common.yesterday', 'Yesterday'),
    });
  }, [ordered, replies.data, me.id, t, newAfter]);

  // Mark read up to the newest message while the channel is open.
  const newest = ordered.length ? ordered[ordered.length - 1] : null;
  // Only while the user can actually see it: not when a task or thread is on top of this
  // channel, and not while the app is in the background.
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (focused && appActive && newest && newest.status === 'sent') markRead(channelId, newest.id);
  }, [channelId, newest, focused, appActive]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || ordered.length === 0) return;
    if (q.data.length >= limit) {
      setLimit((l) => l + PAGE); // more may already be stored on the phone
      return;
    }
    if (!serverHasMore) return;
    setLoadingOlder(true);
    try {
      // Everything local is shown: ask the server for an older page.
      const more = await fetchOlderMessages(channelId, ordered[0].id);
      setServerHasMore(more);
      setLimit((l) => l + PAGE);
    } catch {
      // Offline or failed: keep what we have; scrolling up again retries.
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, q.data.length, limit, serverHasMore, ordered, channelId]);

  return { items, loading: !q.updatedAt, loadOlder, loadingOlder, count: ordered.length };
}

export function useThread(parentId: ID) {
  const parent = useLiveQuery(db.select().from(messages).where(eq(messages.id, parentId)), [parentId]);
  const replies = useLiveQuery(
    db.select().from(messages).where(eq(messages.threadParentId, parentId)).orderBy(asc(messages.createdAt), asc(messages.id)),
    [parentId],
  );
  return { parent: parent.data[0] ?? null, replies: replies.data, loading: !parent.updatedAt };
}

export function usePinned(channelId: ID): Message[] {
  const q = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, channelId), sql`json_extract(${messages.data}, '$.pinned') = 1`, isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt)),
    [channelId],
  );
  return q.data;
}

/** Resolves the DM channel for a person (creating it locally if needed) or the bot DM. */
export function useDmChannelId(userId: string): ID | null {
  const bot = useLiveQuery(db.select().from(channels).where(eq(channels.kind, 'bot')));
  // Runs once per screen: opening a DM may create the conversation on this phone.
  const [dm] = useState<ID | null>(() => {
    if (userId === 'bot') return null;
    try {
      return openDm(userId);
    } catch {
      return null;
    }
  });
  // A conversation opened and left without a message is removed again.
  useEffect(() => {
    if (!dm) return;
    return () => discardEmptyDm(dm);
  }, [dm]);
  return userId === 'bot' ? (bot.data[0]?.id ?? null) : dm;
}
