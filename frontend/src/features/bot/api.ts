import * as Haptics from 'expo-haptics';
import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/api/client';
import { enqueue } from '@/lib/outbox';
import type { Card, CardAnswer } from '@/types/models';

export interface AnswerFiles {
  photoUris: string[];
  voice: { uri: string; seconds: number } | null;
}

/** Answers a card through the send queue; files upload first. Repeating an answer is harmless (the server keeps the first). */
export function answerCard(card: Card, answer: CardAnswer, files: AnswerFiles): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  enqueue({
    kind: 'card',
    cardId: card.id,
    title: card.content.title,
    answer: { ...answer, voiceSec: files.voice?.seconds },
    photos: files.photoUris.map((uri) => ({ attachmentId: uuidv7(), uri })),
    voice: files.voice ? { uri: files.voice.uri, kind: 'voice', name: 'voice-note.m4a', mime: 'audio/mp4' } : undefined,
  });
}

/** The first time the open card is shown. Online-only and best effort: a missed one only means the PM app isn't told. */
export function markSeen(card: Card): void {
  if (card.seenAt || card.sending) return;
  api('POST', `/cards/${card.id}/seen`).catch(() => {});
}
