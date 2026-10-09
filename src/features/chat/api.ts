// Chat writes. Each one changes the local DB and queues an outbox item in ONE transaction.
import { and, eq, ne, sql } from 'drizzle-orm';
import * as Haptics from 'expo-haptics';
import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/api/client';
import { db, type Tx } from '@/lib/db/client';
import { channelMembers, channels, messages, outbox } from '@/lib/db/schema';
import { enqueue, write } from '@/lib/outbox/enqueue';
import { lanes } from '@/lib/outbox/lanes';
import { editUnsentMessage, enqueueMerged, removeUnsentMessage } from '@/lib/outbox/merge';
import { applyIncoming, LOCAL_ONLY, withReaction } from '@/lib/sync/applyIncoming';
import { useSession } from '@/stores/session';
import type { Attachment, ID, Message, MessageType, User } from '@/types/models';

function meId(): ID {
  const id = useSession.getState().user?.id;
  if (!id) throw new Error('No session');
  return id;
}

/** Finds "@First" tokens that match people in the channel. */
export function extractMentions(body: string, candidates: User[]): ID[] {
  const tokens = new Set((body.match(/@([\p{L}]+)/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
  if (tokens.size === 0) return [];
  return candidates.filter((u) => tokens.has(u.name.split(' ')[0].toLowerCase())).map((u) => u.id);
}

export interface NewMessage {
  channelId: ID;
  type: MessageType;
  body: string | null;
  data?: Record<string, unknown> | null;
  threadParentId?: ID | null;
  /** Local file URIs of photos to upload first. */
  photoUris?: string[];
  /** An outbox item that must be sent before this message (e.g. the task a card points at). */
  dependsOn?: ID | null;
}

/** Inserts the message + its outbox items inside an existing transaction. Returns the message id. */
export function queueMessage(tx: Tx, input: NewMessage): ID {
  const me = meId();
  const id = uuidv7();
  const now = new Date().toISOString();
  const photos: Attachment[] = (input.photoUris ?? []).map((uri) => ({ id: uuidv7(), kind: 'image', uri, uploadId: null }));
  const existing = (input.data?.attachments as Attachment[] | undefined) ?? [];
  const data =
    photos.length > 0 || input.data ? { ...(input.data ?? {}), ...(photos.length ? { attachments: [...existing, ...photos] } : {}) } : null;
  tx.insert(messages)
    .values({
      id,
      channelId: input.channelId,
      senderId: me,
      type: input.type,
      body: input.body,
      data,
      threadParentId: input.threadParentId ?? null,
      reactions: {},
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .run();
  ensureDmCreated(tx, input.channelId, me);
  // Uploads go in their own lane; each waits for the previous one, the message waits for the last.
  let dep: ID | null = input.dependsOn ?? null;
  for (const p of photos) {
    dep = enqueue(tx, 'upload_file', lanes.upload, p.id, { clientId: p.id, uri: p.uri ?? '', messageId: id, attachmentId: p.id }, dep);
  }
  enqueue(
    tx,
    'send_message',
    lanes.channel(input.channelId),
    id,
    {
      channelId: input.channelId,
      message: { id, type: input.type, body: input.body, data, threadParentId: input.threadParentId ?? null },
    },
    dep,
  );
  if (!input.threadParentId) {
    tx.update(channelMembers)
      .set({ lastReadMessageId: id })
      .where(
        and(
          eq(channelMembers.channelId, input.channelId),
          eq(channelMembers.userId, me),
          // Never backwards: with a real server the phone's clock may be behind.
          sql`(${channelMembers.lastReadMessageId} IS NULL OR ${channelMembers.lastReadMessageId} < ${id})`,
        ),
      )
      .run();
  }
  return id;
}

/**
 * A direct message conversation is only created on the server when its first message is sent.
 * Until then it exists on this phone alone, so opening a person's chat creates nothing for them.
 */
function ensureDmCreated(tx: Tx, channelId: ID, me: ID): void {
  const ch = tx.select().from(channels).where(eq(channels.id, channelId)).get();
  if (!ch || ch.kind !== 'dm' || ch.updatedAt !== LOCAL_ONLY) return;
  const queued = tx
    .select({ id: outbox.id })
    .from(outbox)
    .where(and(eq(outbox.kind, 'create_dm'), eq(outbox.entityId, channelId)))
    .get();
  if (queued) return;
  const other = tx
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), ne(channelMembers.userId, me)))
    .get();
  // Same lane as the messages, so the conversation always exists before the first one arrives.
  if (other) enqueue(tx, 'create_dm', lanes.channel(channelId), channelId, { channelId, userId: other.userId });
}

/** Leaving a brand-new conversation without writing anything removes it again. */
export function discardEmptyDm(channelId: ID): void {
  db.transaction((tx) => {
    const ch = tx.select().from(channels).where(eq(channels.id, channelId)).get();
    if (!ch || ch.kind !== 'dm' || ch.updatedAt !== LOCAL_ONLY) return;
    const hasMessage = tx.select({ id: messages.id }).from(messages).where(eq(messages.channelId, channelId)).get();
    const hasQueued = tx.select({ id: outbox.id }).from(outbox).where(eq(outbox.lane, lanes.channel(channelId))).get();
    if (hasMessage || hasQueued) return;
    tx.delete(channelMembers).where(eq(channelMembers.channelId, channelId)).run();
    tx.delete(channels).where(eq(channels.id, channelId)).run();
  });
}

export function sendMessage(input: NewMessage): ID {
  let id = '';
  write((tx) => {
    id = queueMessage(tx, input);
  });
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  return id;
}

export function editMessage(message: Message, body: string): void {
  write((tx) => {
    // Not sent yet? Then just change what will be sent; nobody has seen the old text.
    const unsent = editUnsentMessage(tx, message.id, body);
    tx.update(messages)
      .set({ body, data: unsent ? message.data : { ...(message.data ?? {}), edited: true } })
      .where(eq(messages.id, message.id))
      .run();
    if (unsent) return;
    enqueueMerged(
      tx,
      'edit_message',
      lanes.channel(message.channelId),
      message.id,
      { messageId: message.id, body, prevBody: message.body },
      (queued, incoming) => ({ ...queued, ...incoming, prevBody: queued.prevBody }),
    );
  });
}

export function deleteMessage(message: Message): void {
  write((tx) => {
    if (removeUnsentMessage(tx, message.id)) {
      tx.delete(messages).where(eq(messages.id, message.id)).run();
      return;
    }
    tx.update(messages)
      .set({ deletedAt: new Date().toISOString(), body: null, data: null, reactions: {} })
      .where(eq(messages.id, message.id))
      .run();
    enqueue(tx, 'delete_message', lanes.channel(message.channelId), message.id, {
      messageId: message.id,
      prevBody: message.body,
      prevData: message.data,
    });
  });
}

export function toggleReaction(message: Message, emoji: string): void {
  const me = meId();
  const on = !(message.reactions[emoji] ?? []).includes(me);
  write((tx) => {
    tx.update(messages)
      .set({ reactions: withReaction(message.reactions, emoji, me, on) })
      .where(eq(messages.id, message.id))
      .run();
    enqueueMerged(
      tx,
      'set_reaction',
      lanes.channel(message.channelId),
      `${message.id}|${emoji}`,
      { messageId: message.id, emoji, on },
      (_queued, incoming) => incoming,
    );
  });
}

export function setPinned(message: Message, pinned: boolean): void {
  write((tx) => {
    tx.update(messages)
      .set({ data: { ...(message.data ?? {}), pinned } })
      .where(eq(messages.id, message.id))
      .run();
    enqueue(tx, 'edit_message', lanes.channel(message.channelId), message.id, {
      messageId: message.id,
      prevBody: message.body,
      pinned,
    });
  });
}

export function markRead(channelId: ID, upToMessageId: ID): void {
  const me = meId();
  const row = db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, me)))
    .get();
  if (!row || (row.lastReadMessageId && row.lastReadMessageId >= upToMessageId)) return;
  write((tx) => {
    tx.update(channelMembers)
      .set({ lastReadMessageId: upToMessageId })
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, me)))
      .run();
    enqueueMerged(tx, 'mark_read', lanes.meta, channelId, { channelId, upToMessageId }, (_q, incoming) => incoming);
  });
}

/** Returns the DM channel with a person, creating it on this phone if there isn't one yet. */
export function openDm(userId: ID): ID {
  const me = meId();
  const mine = db.select().from(channelMembers).where(eq(channelMembers.userId, me)).all();
  const theirs = new Set(
    db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.userId, userId))
      .all()
      .map((m) => m.channelId),
  );
  const dms = new Set(
    db
      .select()
      .from(channels)
      .where(eq(channels.kind, 'dm'))
      .all()
      .map((c) => c.id),
  );
  const existing = mine.find((m) => theirs.has(m.channelId) && dms.has(m.channelId));
  if (existing) return existing.channelId;
  const id = uuidv7();
  const companyId = useSession.getState().user ? (db.select().from(channels).get()?.companyId ?? '') : '';
  db.transaction((tx) => {
    tx.insert(channels)
      .values({
        id,
        companyId,
        projectId: null,
        name: '',
        kind: 'dm',
        isPrivate: true,
        postingPolicy: 'everyone',
        updatedAt: LOCAL_ONLY,
      })
      .run();
    tx.insert(channelMembers)
      .values([
        { channelId: id, userId: me, lastReadMessageId: null },
        { channelId: id, userId, lastReadMessageId: null },
      ])
      .run();
    // Nothing is queued yet: see ensureDmCreated.
  });
  return id;
}

/** Older history is not offline data: fetch a page and save it locally. */
export async function fetchOlderMessages(channelId: ID, beforeId: ID): Promise<boolean> {
  const res = await api<{ messages: Message[]; hasMore: boolean }>(
    'GET',
    `/channels/${channelId}/messages?before=${encodeURIComponent(beforeId)}&limit=50`,
  );
  if (useSession.getState().user) applyIncoming({ messages: res.messages });
  return res.hasMore;
}
