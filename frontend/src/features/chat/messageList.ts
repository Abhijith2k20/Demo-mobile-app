// How a channel's messages are laid out for the list: day dividers, the "new" divider, and
// grouping a sender's messages that arrive close together. Pure functions; no data fetching.
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import type { ID, MessageView } from '@/types/models';

export type ListItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'new'; key: string }
  | { kind: 'message'; key: string; message: MessageView; grouped: boolean; replies: number; lastReplyAt: string | null };

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const GROUPABLE = new Set(['text', 'image', 'voice', 'file']);

export function dayLabel(iso: string, today: string, yesterday: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return today;
  if (isYesterday(d)) return yesterday;
  return format(d, 'EEE d MMM');
}

/** Lays the messages out for the list: day dividers, the "new" divider, sender grouping. */
/** `newAfter` is the time (server clock) of the last read message; null = all new, undefined = no divider. */
export function buildItems(list: MessageView[], newAfter: string | null | undefined, meId: ID, labels: { today: string; yesterday: string }): ListItem[] {
  const items: ListItem[] = [];
  let prev: MessageView | null = null;
  let newShown = newAfter === undefined; // undefined = don't show a divider at all
  for (const m of list) {
    const localDay = format(parseISO(m.createdAt), 'yyyy-MM-dd');
    const prevDay = prev ? format(parseISO(prev.createdAt), 'yyyy-MM-dd') : null;
    let brokeGroup = false;
    if (localDay !== prevDay) {
      items.push({ kind: 'day', key: `day-${localDay}`, label: dayLabel(m.createdAt, labels.today, labels.yesterday) });
      brokeGroup = true;
    }
    if (!newShown && m.senderId !== meId && (newAfter === null || m.createdAt > (newAfter as string))) {
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
    items.push({ kind: 'message', key: m.id, message: m, grouped, replies: m.replyCount, lastReplyAt: m.lastReplyAt });
    prev = m;
  }
  return items;
}
