import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { api } from '@/lib/api/client';
import { useOutbox, type OutboxItem } from '@/lib/outbox';
import { get, keys } from '@/lib/queries';
import type { ChannelView, ID, JobTitle, MessageView, User } from '@/types/models';
import { shortProjectName, useChannels, useMe, useProject, useUsers } from '../shared';
import { markRead } from './api';
import { buildItems } from './messageList';

export type { ListItem } from './messageList';

export interface ChannelInfo {
  channel: ChannelView | null;
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

export function useChannel(channelId: ID) {
  const list = useChannels();
  return useQuery({
    queryKey: keys.channel(channelId),
    queryFn: get<ChannelView>(`/channels/${channelId}`),
    placeholderData: list.byId.get(channelId),
    enabled: !!channelId,
  });
}

export function useChannelInfo(channelId: ID): ChannelInfo {
  const { t } = useTranslation();
  const q = useChannel(channelId);
  const list = useChannels();
  // If the fetch fails (e.g. no connection), show what the channel list already has.
  const channel = q.data ?? list.byId.get(channelId) ?? null;
  const project = useProject(channel?.projectId);
  const users = useUsers();
  return useMemo(() => {
    const members = (channel?.memberIds ?? []).map((id) => users.byId.get(id)).filter((u): u is User => !!u);
    const peer = channel?.peerId ? (users.byId.get(channel.peerId) ?? null) : null;
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
      loading: q.isPending && !channel,
      title,
      subtitle,
      members,
      peer,
      isBot,
      canPost: !!channel?.canPost,
      projectName,
      jobTitles: new Map((project?.members ?? []).map((m) => [m.userId, m.jobTitle])),
    };
  }, [channel, q.isPending, users.byId, project, t]);
}

type Page = { messages: MessageView[]; hasMore: boolean };

/** A queued message, shown as the user wrote it until the server has it. */
function queuedView(i: Extract<OutboxItem, { kind: 'message' }>): MessageView {
  const attachments = i.photos.map((p) => ({ id: p.attachmentId, kind: 'image' as const, uri: p.url ?? p.uri, uploadId: p.uploadId ?? null }));
  return {
    id: i.id,
    channelId: i.channelId,
    senderId: i.userId,
    type: i.type,
    body: i.body,
    data: attachments.length ? { ...(i.data ?? {}), attachments } : i.data,
    threadParentId: i.threadParentId,
    reactions: {},
    status: i.state === 'failed' ? 'failed' : 'pending',
    createdAt: i.createdAt,
    updatedAt: i.createdAt,
    deletedAt: null,
    replyCount: 0,
    lastReplyAt: null,
    canEdit: false,
    canDelete: false,
    canPin: false,
  };
}

/** Messages for a channel (or one thread) still waiting in the send queue. */
export function useQueuedMessages(channelId: ID, threadParentId: ID | null): MessageView[] {
  const items = useOutbox((st) => st.items);
  return useMemo(
    () =>
      items
        .filter((i): i is Extract<OutboxItem, { kind: 'message' }> => i.kind === 'message' && i.channelId === channelId)
        .filter((i) => (threadParentId ? i.threadParentId === threadParentId : !i.threadParentId || !!i.data?.alsoToChannel))
        .map(queuedView),
    [items, channelId, threadParentId],
  );
}

export function useChannelMessages(channelId: ID) {
  const me = useMe();
  const { t } = useTranslation();
  const channel = useChannel(channelId);
  const q = useInfiniteQuery({
    queryKey: keys.messages(channelId),
    queryFn: ({ pageParam }) =>
      api<Page>('GET', `/channels/${channelId}/messages?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore ? last.messages[last.messages.length - 1]?.id : undefined),
    enabled: !!channelId,
  });

  // Pages arrive newest first; the list shows oldest first, then anything still being sent.
  const fromServer = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.messages).reverse(), [q.data]);
  const queued = useQueuedMessages(channelId, null);
  const ordered = useMemo(() => {
    const known = new Set(fromServer.map((m) => m.id));
    return [...fromServer, ...queued.filter((m) => !known.has(m.id))];
  }, [fromServer, queued]);

  // Remember where "new" started when the screen opened, so the divider stays put while reading.
  // undefined = no divider; null = everything is new.
  const [newAfter, setNewAfter] = useState<{ value: string | null | undefined } | null>(null);
  if (!newAfter && channel.data && !channel.isPlaceholderData && q.data) {
    // Compared by the server's clock, like the unread count (message ids come from phones).
    const marker = channel.data.lastReadAt;
    const hasUnread = ordered.some((m) => m.senderId !== me.id && (marker === null || m.createdAt > marker));
    setNewAfter({ value: hasUnread ? marker : undefined });
  }

  const items = useMemo(
    () => buildItems(ordered, newAfter?.value, me.id, { today: t('common.today', 'Today'), yesterday: t('common.yesterday', 'Yesterday') }),
    [ordered, me.id, t, newAfter],
  );

  // Mark read up to the newest message, only while the user can actually see the channel.
  const newest = fromServer.length ? fromServer[fromServer.length - 1] : null;
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (focused && appActive && newest) markRead(channelId, newest.id);
  }, [channelId, newest, focused, appActive]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  const loadOlder = useCallback(async () => {
    if (hasNextPage && !isFetchingNextPage) await fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return { items, loading: q.isPending, failed: q.isError, loadOlder, loadingOlder: isFetchingNextPage, count: ordered.length };
}

export function useThread(parentId: ID) {
  const q = useQuery({
    queryKey: keys.thread(parentId),
    queryFn: get<{ parent: MessageView; replies: MessageView[] }>(`/messages/${parentId}/thread`),
  });
  const queued = useQueuedMessages(q.data?.parent.channelId ?? '', parentId);
  const replies = useMemo(() => {
    const list = q.data?.replies ?? [];
    const known = new Set(list.map((m) => m.id));
    return [...list, ...queued.filter((m) => !known.has(m.id))];
  }, [q.data?.replies, queued]);
  return { parent: q.data?.parent ?? null, replies, loading: q.isPending };
}

export function usePinned(channelId: ID): MessageView[] {
  const q = useQuery({ queryKey: keys.pins(channelId), queryFn: get<{ messages: MessageView[] }>(`/channels/${channelId}/pins`) });
  return q.data?.messages ?? [];
}

/**
 * The conversation with a person (`/dm/<userId>`) or the bot (`/dm/bot`): its id, `undefined`
 * while the server is asked, or `null` when it can't be opened. An existing conversation comes
 * from the channel list; a new one is created by the server, which keeps it out of everyone's
 * list until the first message, so opening and leaving shows nothing to anyone.
 */
export function useDmChannelId(userId: string): ID | null | undefined {
  const channels = useChannels();
  const known =
    userId === 'bot' ? channels.list.find((c) => c.kind === 'bot') : channels.list.find((c) => c.kind === 'dm' && c.peerId === userId);
  const q = useQuery({
    queryKey: keys.dm(userId),
    queryFn: async () => (await api<{ channel: ChannelView }>('POST', '/dms', { userId })).channel.id,
    enabled: userId !== 'bot' && !channels.loading && !known,
    staleTime: Infinity,
  });
  if (known) return known.id;
  if (channels.loading || q.isPending) return userId === 'bot' && !channels.loading ? null : undefined;
  return q.data ?? null;
}
