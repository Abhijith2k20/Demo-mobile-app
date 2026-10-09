import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';
import { db } from '@/lib/db/client';
import { channelMembers, channels, messages } from '@/lib/db/schema';
import type { Attachment, Channel, ID, Message } from '@/types/models';

const ORDER = ['general', 'design', 'site-work', 'qs'];
const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
/** The four standard channels first, then custom ones by name. */
export const byChannelOrder = (a: Channel, b: Channel): number => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);

export function useProjectChannels(projectId: ID | null | undefined): Channel[] {
  const q = useLiveQuery(db.select().from(channels).where(eq(channels.projectId, projectId ?? '')), [projectId]);
  return useMemo(() => [...q.data].sort(byChannelOrder), [q.data]);
}

/** Which of the project's channels each person is in. */
export function useChannelMembership(projectId: ID | null | undefined): Map<ID, ID[]> {
  const q = useLiveQuery(
    db
      .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .where(eq(channels.projectId, projectId ?? '')),
    [projectId],
  );
  return useMemo(() => {
    const map = new Map<ID, ID[]>();
    for (const r of q.data) map.set(r.userId, [...(map.get(r.userId) ?? []), r.channelId]);
    return map;
  }, [q.data]);
}

/** Last few status cards (check-in results, escalations) across the project's channels. */
export function useRecentUpdates(projectId: ID | null | undefined): Message[] {
  const q = useLiveQuery(
    db
      .select({ message: messages })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(eq(channels.projectId, projectId ?? ''), eq(messages.type, 'status_card'), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(5),
    [projectId],
  );
  return useMemo(() => q.data.map((r) => r.message), [q.data]);
}

export interface ProjectFile {
  key: string;
  kind: 'photo' | 'file';
  photo?: Attachment;
  name?: string;
  at: string;
  senderId: ID;
}

/** Every photo and file posted in the project's channels, newest first. */
export function useProjectFiles(projectId: ID | null | undefined): { files: ProjectFile[]; loading: boolean } {
  const q = useLiveQuery(
    db
      .select({ message: messages })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(
        and(
          eq(channels.projectId, projectId ?? ''),
          inArray(messages.type, ['image', 'file', 'issue_card', 'daily_report']),
          isNull(messages.deletedAt),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(120),
    [projectId],
  );
  return useMemo(() => {
    const files: ProjectFile[] = [];
    for (const { message: m } of q.data) {
      if (m.type === 'file') {
        files.push({ key: m.id, kind: 'file', name: String(m.data?.name ?? 'File'), at: m.createdAt, senderId: m.senderId });
        continue;
      }
      for (const a of (m.data?.attachments as Attachment[] | undefined) ?? []) {
        files.push({ key: `${m.id}-${a.id}`, kind: 'photo', photo: a, at: m.createdAt, senderId: m.senderId });
      }
    }
    return { files, loading: !q.updatedAt };
  }, [q.data, q.updatedAt]);
}
