import { createContext, useContext } from 'react';
import type { ID, MessageView as Message, User } from '@/types/models';

export interface ChatContextValue {
  me: User;
  users: Map<ID, User>;
  /** Lower-cased first names that count as @mentions here. */
  mentionNames: Set<string>;
  inThread: boolean;
  /** The Siteline Bot conversation: everything is laid out in one full-width column. */
  isBotChat: boolean;
  /** A direct message: two people, so bubbles skip names and avatars. */
  isDm: boolean;
  onLongPress: (m: Message) => void;
  onOpenThread: (m: Message) => void;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('ChatContext missing');
  return ctx;
}
