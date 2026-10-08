import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { can, canPost, DELETE_WINDOW_MS, EDIT_WINDOW_MS, isCompanyAdmin } from '@/shared/permissions';
import { messageCreateSchema, messagePatchSchema } from '@/shared/schemas';
import type { Channel, ID, Message, MessageType } from '@/types/models';
import {
  canSeeChannel,
  channelAudience,
  ensureChannelMember,
  nowIso,
  nowMs,
  projectManagers,
  projectRole,
  store,
  type StoredUser,
} from '../db';
import { publish } from '../events';
import { forbidden, MockError, notFound, parse, route, type RouteDef } from '../http';
import { addActivity, firstName } from '../notify';

const CLIENT_TYPES: MessageType[] = ['text', 'image', 'voice', 'file', 'task_card', 'issue_card', 'daily_report'];

function visibleChannel(user: StoredUser, id: ID): Channel {
  const ch = store().channels.get(id);
  if (!ch || !canSeeChannel(user, ch)) throw notFound('Channel');
  return ch;
}

function visibleMessage(user: StoredUser, id: ID): { message: Message; channel: Channel } {
  const message = store().messages.get(id);
  if (!message) throw notFound('Message');
  return { message, channel: visibleChannel(user, message.channelId) };
}

const channelLabel = (ch: Channel): string => (ch.kind === 'dm' || ch.kind === 'bot' ? 'a direct message' : `#${ch.name}`);

/** Internal write used by routes, the bot and scripted teammates. Publishes `message.new`. */
export function postMessage(
  channel: Channel,
  senderId: ID,
  input: {
    id?: ID;
    type: MessageType;
    body: string | null;
    data?: Record<string, unknown> | null;
    threadParentId?: ID | null;
  },
): Message {
  const s = store();
  const ts = nowIso();
  const message: Message = {
    id: input.id ?? uuidv7(),
    channelId: channel.id,
    senderId,
    type: input.type,
    body: input.body,
    data: input.data ?? null,
    threadParentId: input.threadParentId ?? null,
    reactions: {},
    status: 'sent',
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  s.messages.set(message.id, message);
  if (senderId !== s.botId && !message.threadParentId) {
    ensureChannelMember(senderId, channel.id).lastReadMessageId = message.id;
  }
  publish({ type: 'message.new', message }, channelAudience(channel));

  // Notifications: mentions and thread replies notify immediately.
  const audience = new Set(channelAudience(channel));
  const mentions = ((message.data?.mentions as ID[] | undefined) ?? []).filter((id) => audience.has(id));
  for (const userId of mentions) {
    addActivity({
      userId,
      kind: 'mention',
      actorId: senderId,
      projectId: channel.projectId,
      channelId: channel.id,
      messageId: message.threadParentId ?? message.id,
      taskIds: [],
      text: `${firstName(senderId)} mentioned you in ${channelLabel(channel)}`,
      lines: [message.body ?? (message.data?.what as string | undefined) ?? ''],
    });
  }
  if (message.threadParentId) {
    const parent = s.messages.get(message.threadParentId);
    const participants = new Set<ID>();
    if (parent) participants.add(parent.senderId);
    for (const m of s.messages.values()) {
      if (m.threadParentId === message.threadParentId) participants.add(m.senderId);
    }
    for (const userId of participants) {
      if (mentions.includes(userId)) continue;
      addActivity({
        userId,
        kind: 'thread_reply',
        actorId: senderId,
        projectId: channel.projectId,
        channelId: channel.id,
        messageId: message.threadParentId,
        taskIds: [],
        text: `${firstName(senderId)} replied in a thread in ${channelLabel(channel)}`,
        lines: [message.body ?? ''],
      });
    }
  }
  return message;
}

function touch(message: Message, type: 'message.updated' | 'message.deleted', channel: Channel): Message {
  message.updatedAt = nowIso();
  publish({ type, message }, channelAudience(channel));
  return message;
}

const readSchema = z.object({ upToMessageId: z.string().min(8) });
const reactionSchema = z.object({ on: z.boolean() });
const dmSchema = z.object({ id: z.string().min(8), userId: z.string().min(8) });

export const messageRoutes: RouteDef[] = [
  route('GET', '/channels/:id/messages', ({ user, params, query }) => {
    const ch = visibleChannel(user, params.id);
    const limit = Math.min(Number(query.limit) || 50, 100);
    const all = [...store().messages.values()]
      .filter((m) => m.channelId === ch.id && (!query.before || m.id < query.before))
      .sort((a, b) => (a.id < b.id ? 1 : -1));
    return { messages: all.slice(0, limit), hasMore: all.length > limit };
  }),

  route('POST', '/channels/:id/messages', ({ user, params, body }) => {
    const s = store();
    const ch = visibleChannel(user, params.id);
    const input = parse(messageCreateSchema, body);
    const existing = s.messages.get(input.id);
    if (existing) return existing; // idempotent create: no second event
    if (!canPost(user, ch) || ch.kind === 'bot') {
      throw new MockError('CHANNEL_READ_ONLY', 'Only admins can post here.');
    }
    if (!CLIENT_TYPES.includes(input.type)) {
      throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { type: 'Not allowed' } });
    }
    if (input.type === 'text' && !input.body?.trim()) {
      throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { body: 'Write a message' } });
    }
    if (input.threadParentId) {
      const parent = s.messages.get(input.threadParentId);
      if (!parent || parent.channelId !== ch.id) throw notFound('Message');
    }
    // A photo message may only arrive after its uploads have finished.
    const attachments = (input.data?.attachments as { uri: string | null; uploadId: string | null }[] | undefined) ?? [];
    for (const a of attachments) {
      if (a.uri && !(a.uploadId && s.uploads.get(a.uploadId)?.done)) {
        throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { attachments: 'Upload not finished' } });
      }
    }
    let data = input.data;
    if (input.type === 'issue_card' && data?.urgency === 'urgent' && ch.projectId) {
      // Urgent issues mention the project's Managers (server decides who they are).
      data = { ...data, mentions: projectManagers(ch.projectId).filter((id) => id !== user.id) };
    }
    return postMessage(ch, user.id, { ...input, data });
  }),

  route('PATCH', '/messages/:id', ({ user, params, body }) => {
    const { message, channel } = visibleMessage(user, params.id);
    const input = parse(messagePatchSchema, body);
    if (message.deletedAt) throw notFound('Message');
    if (input.body !== undefined) {
      if (message.senderId !== user.id) throw forbidden('You can only edit your own messages.');
      if (nowMs() - Date.parse(message.createdAt) > EDIT_WINDOW_MS) {
        throw new MockError('MESSAGE_EDIT_WINDOW_PASSED', 'Messages can be edited for 15 minutes.');
      }
      message.body = input.body;
      message.data = { ...(message.data ?? {}), edited: true };
    }
    if (input.pinned !== undefined) {
      const role = channel.projectId ? projectRole(user.id, channel.projectId) : null;
      if (!can(user, 'message.pin', { projectRole: role })) throw forbidden('Only managers can pin messages.');
      message.data = { ...(message.data ?? {}), pinned: input.pinned };
    }
    return touch(message, 'message.updated', channel);
  }),

  route('DELETE', '/messages/:id', ({ user, params }) => {
    const { message, channel } = visibleMessage(user, params.id);
    if (message.deletedAt) return message;
    const role = channel.projectId ? projectRole(user.id, channel.projectId) : null;
    const canAny = channel.projectId
      ? can(user, 'message.delete_any', { projectRole: role })
      : isCompanyAdmin(user) && channel.kind === 'company';
    if (!canAny) {
      if (message.senderId !== user.id) throw forbidden('You can only delete your own messages.');
      if (nowMs() - Date.parse(message.createdAt) > DELETE_WINDOW_MS) {
        throw new MockError('MESSAGE_EDIT_WINDOW_PASSED', 'Messages can be deleted for 1 hour.');
      }
    }
    message.deletedAt = nowIso();
    message.body = null;
    message.data = null;
    message.reactions = {};
    return touch(message, 'message.deleted', channel);
  }),

  route('PUT', '/messages/:id/reactions/:emoji', ({ user, params, body }) => {
    const { message, channel } = visibleMessage(user, params.id);
    const { on } = parse(reactionSchema, body);
    const current = new Set(message.reactions[params.emoji] ?? []);
    if (on) current.add(user.id);
    else current.delete(user.id);
    const next = { ...message.reactions };
    if (current.size > 0) next[params.emoji] = [...current];
    else delete next[params.emoji];
    message.reactions = next;
    return touch(message, 'message.updated', channel);
  }),

  route('POST', '/channels/:id/read', ({ user, params, body }) => {
    const ch = visibleChannel(user, params.id);
    const { upToMessageId } = parse(readSchema, body);
    const row = ensureChannelMember(user.id, ch.id);
    if (!row.lastReadMessageId || upToMessageId > row.lastReadMessageId) row.lastReadMessageId = upToMessageId;
    return { channelId: ch.id, lastReadMessageId: row.lastReadMessageId };
  }),

  // Demo addition: open a DM (idempotent by client id, or by the pair of people).
  route('POST', '/dms', ({ user, body }) => {
    const s = store();
    const input = parse(dmSchema, body);
    const other = s.users.get(input.userId);
    if (!other || !other.isActive || other.id === s.botId || other.id === user.id) throw notFound('Person');
    const existing =
      s.channels.get(input.id) ??
      [...s.channels.values()].find(
        (c) =>
          c.kind === 'dm' &&
          s.channelMembers.some((m) => m.channelId === c.id && m.userId === user.id) &&
          s.channelMembers.some((m) => m.channelId === c.id && m.userId === other.id),
      );
    if (existing) return { channel: existing };
    const ts = nowIso();
    const channel: Channel = {
      id: input.id,
      companyId: s.companyId,
      projectId: null,
      name: '',
      kind: 'dm',
      isPrivate: true,
      postingPolicy: 'everyone',
      updatedAt: ts,
    };
    s.channels.set(channel.id, channel);
    for (const userId of [user.id, other.id]) {
      s.channelMembers.push({ channelId: channel.id, userId, lastReadMessageId: null, joinedAt: ts });
      publish({ type: 'channel.member_added', channelId: channel.id, userId }, [user.id, other.id]);
    }
    return { channel };
  }),
];
