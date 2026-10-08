import { createContext, useContext } from 'react';
import type { ID, JobTitle, Message, User } from '@/types/models';

export interface ChatContextValue {
  me: User;
  users: Map<ID, User>;
  jobTitles: Map<ID, JobTitle>;
  /** Lower-cased first names that count as @mentions here. */
  mentionNames: Set<string>;
  inThread: boolean;
  onLongPress: (m: Message) => void;
  onOpenThread: (m: Message) => void;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('ChatContext missing');
  return ctx;
}

export const BOT_PHONE = '0000000000';
export const isBotUser = (u: User | undefined): boolean => u?.phone === BOT_PHONE;
