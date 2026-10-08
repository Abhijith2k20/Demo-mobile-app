import { eq } from 'drizzle-orm';
import { api } from '@/lib/api/client';
import { db } from '@/lib/db/client';
import { messages, outbox } from '@/lib/db/schema';
import { errorText } from '@/lib/i18n';
import { applyIncoming, withReaction } from '@/lib/sync/applyIncoming';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/ui';
import type { Attachment, Channel, Message } from '@/types/models';
import { readPayload, type Handler } from '../types';

export const sendMessage: Handler<'send_message'> = {
  async send(p) {
    // The message id is a client UUID: sending twice returns the same message (rule 4).
    const saved = await api<Message>('POST', `/channels/${p.channelId}/messages`, p.message);
    return () => applyIncoming({ messages: [saved] });
  },
  onPermanentFailure(p) {
    // Keep the message with a red mark; the user can retry, edit or discard it.
    db.update(messages).set({ status: 'failed' }).where(eq(messages.id, p.message.id)).run();
  },
};

export const editMessage: Handler<'edit_message'> = {
  async send(p) {
    const saved = await api<Message>('PATCH', `/messages/${p.messageId}`, { body: p.body, pinned: p.pinned });
    return () => applyIncoming({ messages: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    const row = db.select().from(messages).where(eq(messages.id, p.messageId)).get();
    if (row) {
      const data = row.data ? { ...row.data } : null;
      if (data && p.pinned !== undefined) data.pinned = !p.pinned;
      db.update(messages)
        .set({ body: p.body !== undefined ? p.prevBody : row.body, data })
        .where(eq(messages.id, p.messageId))
        .run();
    }
    toast(errorText(error), 'danger');
  },
};

export const deleteMessage: Handler<'delete_message'> = {
  async send(p) {
    const saved = await api<Message>('DELETE', `/messages/${p.messageId}`);
    return () => applyIncoming({ messages: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    db.update(messages)
      .set({ deletedAt: null, body: p.prevBody, data: p.prevData })
      .where(eq(messages.id, p.messageId))
      .run();
    toast(errorText(error), 'danger');
  },
};

export const setReaction: Handler<'set_reaction'> = {
  async send(p) {
    // Absolute value ("on"/"off"), never a toggle, so a repeat is harmless.
    const saved = await api<Message>('PUT', `/messages/${p.messageId}/reactions/${encodeURIComponent(p.emoji)}`, { on: p.on });
    return () => applyIncoming({ messages: [saved] });
  },
  onPermanentFailure(p) {
    const me = useSession.getState().user?.id;
    const row = db.select().from(messages).where(eq(messages.id, p.messageId)).get();
    if (me && row) {
      db.update(messages).set({ reactions: withReaction(row.reactions, p.emoji, me, !p.on) }).where(eq(messages.id, p.messageId)).run();
    }
  },
};

export const markRead: Handler<'mark_read'> = {
  async send(p) {
    await api('POST', `/channels/${p.channelId}/read`, { upToMessageId: p.upToMessageId });
  },
};

export const createDm: Handler<'create_dm'> = {
  async send(p) {
    const res = await api<{ channel: Channel }>('POST', '/dms', { id: p.channelId, userId: p.userId });
    return () => applyIncoming({ channels: [res.channel] });
  },
};

export const uploadFile: Handler<'upload_file'> = {
  async send(p) {
    const ticket = await api<{ uploadId: string; uploadUrl: string }>('POST', '/uploads', { clientId: p.clientId });
    await api('PUT', ticket.uploadUrl, { uri: p.uri });
    return () => {
      // Tell the waiting message (and its queued send) which upload it now points at.
      db.transaction((tx) => {
        const patch = (list: Attachment[] | undefined) =>
          (list ?? []).map((a) => (a.id === p.attachmentId ? { ...a, uploadId: ticket.uploadId } : a));
        const row = tx.select().from(messages).where(eq(messages.id, p.messageId)).get();
        if (row?.data) {
          const data = { ...row.data, attachments: patch(row.data.attachments as Attachment[] | undefined) };
          tx.update(messages).set({ data }).where(eq(messages.id, p.messageId)).run();
        }
        const queued = tx.select().from(outbox).where(eq(outbox.entityId, p.messageId)).all();
        for (const item of queued) {
          if (item.kind !== 'send_message') continue;
          const sp = readPayload<'send_message'>(item);
          if (sp.message.data) {
            sp.message.data = { ...sp.message.data, attachments: patch(sp.message.data.attachments as Attachment[] | undefined) };
            tx.update(outbox).set({ payload: JSON.stringify(sp) }).where(eq(outbox.id, item.id)).run();
          }
        }
      });
    };
  },
};
