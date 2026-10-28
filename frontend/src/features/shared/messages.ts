// Sending a message, used by chat, tasks (task cards, issues) and bot forms. It only adds to the
// send queue; the server decides the rest.
import * as Haptics from 'expo-haptics';
import { uuidv7 } from 'uuidv7';
import { enqueue } from '@/lib/outbox';
import type { ID, MessageType, User } from '@/types/models';

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
}

/**
 * Sends a message through the send queue: it shows at once as "sending" and goes out when the
 * server can be reached. Photos upload first. Returns the message id.
 */
export function sendMessage(input: NewMessage): ID {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  return enqueue({
    kind: 'message',
    channelId: input.channelId,
    type: input.type,
    body: input.body,
    data: input.data ?? null,
    threadParentId: input.threadParentId ?? null,
    photos: (input.photoUris ?? []).map((uri) => ({ attachmentId: uuidv7(), uri })),
  });
}
