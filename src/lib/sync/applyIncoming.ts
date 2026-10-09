// Saves records that arrive from sync, live events or API replies into the local database.
import { and, asc, eq, getTableColumns, inArray, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db, type Tx } from '@/lib/db/client';
import {
  activity,
  channelMembers,
  channels,
  checkins,
  messages,
  outbox,
  projectMembers,
  projects,
  taskHistory,
  tasks,
  users,
} from '@/lib/db/schema';
import { readPayload } from '@/lib/outbox/types';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/ui';
import i18n from '@/lib/i18n';
import type {
  Activity,
  Channel,
  ChannelMember,
  Checkin,
  ID,
  Message,
  Project,
  ProjectMember,
  Task,
  TaskHistory,
  User,
} from '@/types/models';

export interface Incoming {
  users?: User[];
  projects?: Project[];
  /** When present, this is the complete list of memberships the user may see. */
  projectMembers?: ProjectMember[];
  channels?: Channel[];
  /** When present, this is the complete list of memberships the user may see. */
  channelMembers?: ChannelMember[];
  messages?: Message[];
  tasks?: Task[];
  taskHistory?: TaskHistory[];
  checkins?: Checkin[];
  activities?: Activity[];
  removed?: { projects?: ID[]; channels?: ID[]; tasks?: ID[]; messages?: ID[] };
  /** True for a from-scratch sync: projects and channels not in this batch are dropped locally. */
  fullSnapshot?: boolean;
}

/** `updatedAt` of a row that exists only on this phone so far (the server always sends a real time). */
export const LOCAL_ONLY = new Date(0).toISOString();

const CHUNK = 60;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** `SET col = excluded.col` for every column of a table. */
function excluded(table: SQLiteTable): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) set[key] = sql.raw(`excluded."${col.name}"`);
  return set;
}

/**
 * Rule 6 — re-apply unsent changes on top of whatever the server just sent, so a sync or an
 * event never makes the user's own pending edit flicker back to the old value.
 */
export function reapplyPending(tx: Tx, touched: { tasks: Set<ID>; messages: Set<ID>; readMarkers: boolean; projects: Set<ID>; checkins: Set<ID> }): void {
  const me = useSession.getState().user?.id;
  const items = tx.select().from(outbox).where(ne(outbox.status, 'failed')).orderBy(asc(outbox.createdAt), asc(outbox.id)).all();
  for (const item of items) {
    switch (item.kind) {
      case 'update_task': {
        const p = readPayload<'update_task'>(item);
        if (touched.tasks.has(p.taskId)) tx.update(tasks).set(p.local).where(eq(tasks.id, p.taskId)).run();
        break;
      }
      case 'checkin_answer': {
        const p = readPayload<'checkin_answer'>(item);
        if (touched.tasks.has(p.taskId)) tx.update(tasks).set(p.local).where(eq(tasks.id, p.taskId)).run();
        if (touched.checkins.has(p.checkinId)) {
          tx.update(checkins).set({ answer: p.answer }).where(eq(checkins.id, p.checkinId)).run();
        }
        break;
      }
      case 'edit_message': {
        const p = readPayload<'edit_message'>(item);
        if (touched.messages.has(p.messageId) && p.body !== undefined) {
          tx.update(messages).set({ body: p.body }).where(eq(messages.id, p.messageId)).run();
        }
        break;
      }
      case 'delete_message': {
        const p = readPayload<'delete_message'>(item);
        if (touched.messages.has(p.messageId)) {
          tx.update(messages)
            .set({ deletedAt: new Date().toISOString(), body: null, data: null })
            .where(eq(messages.id, p.messageId))
            .run();
        }
        break;
      }
      case 'set_reaction': {
        const p = readPayload<'set_reaction'>(item);
        if (!me || !touched.messages.has(p.messageId)) break;
        const row = tx.select().from(messages).where(eq(messages.id, p.messageId)).get();
        if (row) {
          tx.update(messages)
            .set({ reactions: withReaction(row.reactions, p.emoji, me, p.on) })
            .where(eq(messages.id, p.messageId))
            .run();
        }
        break;
      }
      case 'mark_read': {
        const p = readPayload<'mark_read'>(item);
        if (!me || !touched.readMarkers) break;
        tx.update(channelMembers)
          .set({ lastReadMessageId: p.upToMessageId })
          .where(
            and(
              eq(channelMembers.channelId, p.channelId),
              eq(channelMembers.userId, me),
              sql`(${channelMembers.lastReadMessageId} IS NULL OR ${channelMembers.lastReadMessageId} < ${p.upToMessageId})`,
            ),
          )
          .run();
        break;
      }
      case 'project_stage': {
        const p = readPayload<'project_stage'>(item);
        if (touched.projects.has(p.projectId)) tx.update(projects).set({ stage: p.stage }).where(eq(projects.id, p.projectId)).run();
        break;
      }
      default:
        break;
    }
  }
}

export function withReaction(reactions: Record<string, ID[]>, emoji: string, userId: ID, on: boolean): Record<string, ID[]> {
  const next = { ...reactions };
  const set = new Set(next[emoji] ?? []);
  if (on) set.add(userId);
  else set.delete(userId);
  if (set.size > 0) next[emoji] = [...set];
  else delete next[emoji];
  return next;
}

export function removeChannelsLocal(tx: Tx, ids: ID[]): void {
  if (ids.length === 0) return;
  tx.delete(messages).where(inArray(messages.channelId, ids)).run();
  tx.delete(channelMembers).where(inArray(channelMembers.channelId, ids)).run();
  tx.delete(channels).where(inArray(channels.id, ids)).run();
}

/** Writes one batch in a single transaction. Newer `updatedAt` wins. */
export function applyIncoming(inc: Incoming): void {
  const me = useSession.getState().user?.id;
  const lostProjects: string[] = [];

  db.transaction((tx) => {
    if (inc.fullSnapshot) {
      // Things created on this phone and not sent yet are not on the server: keep them.
      const unsentCreates = tx
        .select({ kind: outbox.kind, entityId: outbox.entityId })
        .from(outbox)
        .where(inArray(outbox.kind, ['create_project', 'create_channel', 'create_dm', 'join_channel']))
        .all();
      const localDms = tx
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.kind, 'dm'), eq(channels.updatedAt, LOCAL_ONLY)))
        .all();
      const keepProjects = [
        ...(inc.projects ?? []).map((p) => p.id),
        ...unsentCreates.filter((i) => i.kind === 'create_project').map((i) => i.entityId),
      ];
      const keepChannels = [
        ...(inc.channels ?? []).map((c) => c.id),
        ...unsentCreates.filter((i) => i.kind !== 'create_project').map((i) => i.entityId),
        ...localDms.map((c) => c.id),
      ];
      const goneChannels = tx.select({ id: channels.id }).from(channels).where(notInArray(channels.id, keepChannels)).all();
      removeChannelsLocal(tx, goneChannels.map((c) => c.id));
      tx.delete(tasks).where(notInArray(tasks.projectId, keepProjects)).run();
      tx.delete(projects).where(notInArray(projects.id, keepProjects)).run();
    }
    for (const part of chunks(inc.users ?? [])) {
      tx.insert(users)
        .values(part.map((u) => ({ ...u, online: u.online ?? false })))
        .onConflictDoUpdate({ target: users.id, set: excluded(users) })
        .run();
    }
    for (const part of chunks(inc.projects ?? [])) {
      tx.insert(projects)
        .values(part)
        .onConflictDoUpdate({ target: projects.id, set: excluded(projects), setWhere: sql`excluded.updated_at >= ${projects.updatedAt}` })
        .run();
    }
    for (const part of chunks(inc.channels ?? [])) {
      tx.insert(channels)
        .values(part)
        .onConflictDoUpdate({ target: channels.id, set: excluded(channels), setWhere: sql`excluded.updated_at >= ${channels.updatedAt}` })
        .run();
    }
    if (inc.projectMembers) {
      tx.delete(projectMembers).run();
      for (const part of chunks(inc.projectMembers)) tx.insert(projectMembers).values(part).onConflictDoNothing().run();
    }
    if (inc.channelMembers) {
      tx.delete(channelMembers).run();
      for (const part of chunks(inc.channelMembers)) tx.insert(channelMembers).values(part).onConflictDoNothing().run();
    }
    for (const part of chunks(inc.messages ?? [])) {
      tx.insert(messages)
        .values(part.map((m) => ({ ...m, status: 'sent' as const })))
        .onConflictDoUpdate({ target: messages.id, set: excluded(messages), setWhere: sql`excluded.updated_at >= ${messages.updatedAt}` })
        .run();
    }
    for (const part of chunks(inc.tasks ?? [])) {
      tx.insert(tasks)
        .values(part)
        .onConflictDoUpdate({ target: tasks.id, set: excluded(tasks), setWhere: sql`excluded.updated_at >= ${tasks.updatedAt}` })
        .run();
    }
    for (const part of chunks(inc.taskHistory ?? [])) tx.insert(taskHistory).values(part).onConflictDoNothing().run();
    for (const part of chunks(inc.checkins ?? [])) {
      tx.insert(checkins).values(part).onConflictDoUpdate({ target: checkins.id, set: excluded(checkins) }).run();
    }
    for (const part of chunks(inc.activities ?? [])) {
      tx.insert(activity)
        .values(part.map((a) => ({ ...a, readAt: null })))
        .onConflictDoNothing()
        .run();
    }

    const removed = inc.removed;
    if (removed) {
      if (removed.messages?.length) tx.delete(messages).where(inArray(messages.id, removed.messages)).run();
      if (removed.tasks?.length) {
        tx.delete(taskHistory).where(inArray(taskHistory.taskId, removed.tasks)).run();
        tx.delete(tasks).where(inArray(tasks.id, removed.tasks)).run();
      }
      removeChannelsLocal(tx, removed.channels ?? []);
      if (removed.projects?.length) {
        const rows = tx.select().from(projects).where(inArray(projects.id, removed.projects)).all();
        lostProjects.push(...rows.map((p) => p.name.split(' – ')[0]));
        const orphanChannels = tx.select({ id: channels.id }).from(channels).where(inArray(channels.projectId, removed.projects)).all();
        removeChannelsLocal(tx, orphanChannels.map((c) => c.id));
        tx.delete(tasks).where(inArray(tasks.projectId, removed.projects)).run();
        tx.delete(projectMembers).where(inArray(projectMembers.projectId, removed.projects)).run();
        tx.delete(projects).where(inArray(projects.id, removed.projects)).run();
      }
    }

    reapplyPending(tx, {
      tasks: new Set((inc.tasks ?? []).map((t) => t.id)),
      messages: new Set((inc.messages ?? []).map((m) => m.id)),
      readMarkers: !!inc.channelMembers,
      projects: new Set((inc.projects ?? []).map((p) => p.id)),
      checkins: new Set((inc.checkins ?? []).map((c) => c.id)),
    });

    if (me && (inc.projectMembers || inc.users)) {
      const mine = tx.select().from(projectMembers).where(eq(projectMembers.userId, me)).all();
      useSession.getState().setWorkerMode(mine.length > 0 && mine.every((m) => m.jobTitle === 'Worker'));
    }
  });

  for (const name of lostProjects) toast(i18n.t('errors.removedFromProject', { name }), 'info');
}
