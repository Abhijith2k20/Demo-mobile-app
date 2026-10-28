// Chat writes. New messages go through the send queue; edits, deletes, reactions and pins need
// the connection. The server decides either way.
import { api } from '@/lib/api/client';
import { attempt } from '@/lib/mutations';
import { keys } from '@/lib/queries';
import { useSession } from '@/stores/session';
import type { ID, Message } from '@/types/models';

const channelKeys = (channelId: ID, parentId?: ID | null) => [
  keys.messages(channelId),
  keys.channels,
  keys.channel(channelId),
  ...(parentId ? [keys.thread(parentId)] : []),
];

export function editMessage(message: Message, body: string): Promise<Message | null> {
  return attempt(() => api<Message>('PATCH', `/messages/${message.id}`, { body }), channelKeys(message.channelId, message.threadParentId));
}

export function deleteMessage(message: Message): Promise<Message | null> {
  return attempt(() => api<Message>('DELETE', `/messages/${message.id}`), channelKeys(message.channelId, message.threadParentId));
}

export function toggleReaction(message: Message, emoji: string): Promise<Message | null> {
  const on = !(message.reactions[emoji] ?? []).includes(useSession.getState().user?.id ?? '');
  return attempt(
    () => api<Message>('PUT', `/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`, { on }),
    channelKeys(message.channelId, message.threadParentId),
  );
}

export function setPinned(message: Message, pinned: boolean): Promise<Message | null> {
  return attempt(() => api<Message>('PATCH', `/messages/${message.id}`, { pinned }), [...channelKeys(message.channelId), keys.pins(message.channelId)]);
}

const lastMarked = new Map<string, ID>();

/** Read marker; sent once per new newest message, quietly (housekeeping never shows an error). */
export function markRead(channelId: ID, upToMessageId: ID): void {
  // Per person: after a user switch the new person's markers are their own.
  const key = `${useSession.getState().user?.id}|${channelId}`;
  const prev = lastMarked.get(key);
  if (prev === upToMessageId) return; // the server only moves the marker forward
  lastMarked.set(key, upToMessageId);
  api('POST', `/channels/${channelId}/read`, { upToMessageId }).catch(() => lastMarked.delete(key));
}
