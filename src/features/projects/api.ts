import { and, eq, inArray, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db } from '@/lib/db/client';
import { channelMembers, channels, outbox, projectMembers, projects, taskHistory, tasks } from '@/lib/db/schema';
import type { ProjectDetails } from '@/lib/outbox/types';
import { removeChannelsLocal } from '@/lib/sync/applyIncoming';
import { useSession } from '@/stores/session';
import { enqueue, write } from '@/lib/outbox/enqueue';
import { lanes } from '@/lib/outbox/lanes';
import { enqueueMerged } from '@/lib/outbox/merge';
import { todayIso } from '@/shared/taskRules';
import type { Channel, ID, JobTitle, Project, ProjectRole } from '@/types/models';

export function createProject(input: { name: string; client: string; address: string }): ID {
  const id = uuidv7();
  const companyId = db.select().from(projects).get()?.companyId ?? '';
  write((tx) => {
    tx.insert(projects)
      .values({
        id,
        companyId,
        name: input.name.trim(),
        client: input.client.trim(),
        address: input.address.trim(),
        stage: 'design',
        startDate: todayIso(),
        plannedFinish: todayIso(),
        baselineFinish: null,
        baselineLocked: false,
        archivedAt: null,
        updatedAt: new Date(0).toISOString(),
      })
      .run();
    enqueue(tx, 'create_project', lanes.meta, id, { id, name: input.name.trim(), client: input.client.trim(), address: input.address.trim() });
  });
  return id;
}

export function addMember(input: { projectId: ID; userId: ID; role: ProjectRole; jobTitle: JobTitle; channelIds: ID[] }): void {
  write((tx) => {
    tx.insert(projectMembers)
      .values({ projectId: input.projectId, userId: input.userId, role: input.role, jobTitle: input.jobTitle })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: input.role, jobTitle: input.jobTitle } })
      .run();
    for (const channelId of input.channelIds) {
      tx.insert(channelMembers).values({ channelId, userId: input.userId, lastReadMessageId: null }).onConflictDoNothing().run();
    }
    enqueue(tx, 'member_add', lanes.project(input.projectId), `${input.projectId}|${input.userId}`, input);
  });
}

export function updateMember(input: { projectId: ID; userId: ID; role: ProjectRole; jobTitle: JobTitle; channelIds: ID[] }): void {
  write((tx) => {
    tx.update(projectMembers)
      .set({ role: input.role, jobTitle: input.jobTitle })
      .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)))
      .run();
    const projectChannelIds = tx
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.projectId, input.projectId))
      .all()
      .map((c) => c.id);
    // Remove only the channels they are leaving; rows that stay keep their read marker.
    const leaving = projectChannelIds.filter((id) => !input.channelIds.includes(id));
    if (leaving.length) {
      tx.delete(channelMembers)
        .where(and(eq(channelMembers.userId, input.userId), inArray(channelMembers.channelId, leaving)))
        .run();
    }
    for (const channelId of input.channelIds) {
      tx.insert(channelMembers).values({ channelId, userId: input.userId, lastReadMessageId: null }).onConflictDoNothing().run();
    }
    enqueueMerged(tx, 'member_update', lanes.project(input.projectId), `${input.projectId}|${input.userId}`, input, (_q, incoming) => incoming);
  });
}

export function removeMember(projectId: ID, userId: ID): void {
  write((tx) => {
    tx.delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .run();
    const projectChannelIds = tx
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.projectId, projectId))
      .all()
      .map((c) => c.id);
    if (projectChannelIds.length) {
      tx.delete(channelMembers)
        .where(and(eq(channelMembers.userId, userId), inArray(channelMembers.channelId, projectChannelIds)))
        .run();
    }
    enqueue(tx, 'member_remove', lanes.project(projectId), `${projectId}|${userId}`, { projectId, userId });
  });
}

// ---- Project settings ----

export function updateProjectDetails(project: Project, changes: ProjectDetails): void {
  write((tx) => {
    tx.update(projects).set(changes).where(eq(projects.id, project.id)).run();
    enqueueMerged(
      tx,
      'update_project',
      lanes.project(project.id),
      project.id,
      { projectId: project.id, changes, prev: { name: project.name, client: project.client, address: project.address } },
      (queued, incoming) => ({ ...incoming, prev: queued.prev }),
    );
  });
}

/** Replaces a channel's project members locally (Owner/Admin rows are left alone). */
function setLocalMembers(tx: Parameters<Parameters<typeof write>[0]>[0], projectId: ID, channelId: ID, memberIds: ID[]): void {
  const projectUserIds = tx
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .all()
    .map((m) => m.id);
  // Remove only people who are no longer in it; rows that stay keep their read marker.
  const leaving = projectUserIds.filter((id) => !memberIds.includes(id));
  if (leaving.length) {
    tx.delete(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), inArray(channelMembers.userId, leaving)))
      .run();
  }
  for (const userId of memberIds) {
    tx.insert(channelMembers).values({ channelId, userId, lastReadMessageId: null }).onConflictDoNothing().run();
  }
}

export function createChannel(input: { projectId: ID; name: string; isPrivate: boolean; memberIds: ID[] }): ID {
  const id = uuidv7();
  const me = useSession.getState().user?.id;
  const companyId = db.select().from(projects).where(eq(projects.id, input.projectId)).get()?.companyId ?? '';
  write((tx) => {
    tx.insert(channels)
      .values({
        id,
        companyId,
        projectId: input.projectId,
        name: input.name,
        kind: 'project',
        isPrivate: input.isPrivate,
        postingPolicy: 'everyone',
        updatedAt: new Date(0).toISOString(),
      })
      .run();
    setLocalMembers(tx, input.projectId, id, input.memberIds);
    // The creator can always see what they just made (Owner/Admin are not project members).
    if (me) tx.insert(channelMembers).values({ channelId: id, userId: me, lastReadMessageId: null }).onConflictDoNothing().run();
    enqueue(tx, 'create_channel', lanes.project(input.projectId), id, { ...input, id });
  });
  return id;
}

export function updateChannel(channel: Channel, changes: { name?: string; isPrivate?: boolean; memberIds?: ID[] }): void {
  const projectId = channel.projectId;
  if (!projectId) return;
  write((tx) => {
    const fields: { name?: string; isPrivate?: boolean } = {};
    if (changes.name !== undefined) fields.name = changes.name;
    if (changes.isPrivate !== undefined) fields.isPrivate = changes.isPrivate;
    if (Object.keys(fields).length) tx.update(channels).set(fields).where(eq(channels.id, channel.id)).run();
    if (changes.memberIds) setLocalMembers(tx, projectId, channel.id, changes.memberIds);
    enqueueMerged(
      tx,
      'update_channel',
      lanes.project(projectId),
      channel.id,
      { projectId, channelId: channel.id, ...changes },
      (queued, incoming) => ({ ...queued, ...incoming }),
    );
  });
}

export function deleteChannel(channel: Channel): void {
  const projectId = channel.projectId;
  if (!projectId) return;
  write((tx) => {
    removeChannelsLocal(tx, [channel.id]);
    // Messages still waiting to be sent to this channel have nowhere to go.
    tx.delete(outbox)
      .where(and(eq(outbox.lane, lanes.channel(channel.id)), ne(outbox.status, 'sending')))
      .run();
    enqueue(tx, 'delete_channel', lanes.project(projectId), channel.id, { projectId, channelId: channel.id });
  });
}

/** Joins a public channel found in "Browse channels". Its history arrives with the next sync. */
export function joinChannel(channel: Channel): void {
  const me = useSession.getState().user?.id;
  if (!me) return;
  write((tx) => {
    const { id, companyId, projectId, name, kind, isPrivate, postingPolicy } = channel;
    tx.insert(channels)
      .values({ id, companyId, projectId, name, kind, isPrivate, postingPolicy, updatedAt: new Date(0).toISOString() })
      .onConflictDoNothing()
      .run();
    tx.insert(channelMembers).values({ channelId: id, userId: me, lastReadMessageId: null }).onConflictDoNothing().run();
    enqueue(tx, 'join_channel', lanes.channel(id), id, { channelId: id, on: true });
  });
}

export function leaveChannel(channel: Channel): void {
  write((tx) => {
    removeChannelsLocal(tx, [channel.id]);
    enqueue(tx, 'join_channel', lanes.channel(channel.id), channel.id, { channelId: channel.id, on: false });
  });
}

/** Archive makes the whole project read-only; unarchive brings it back. Nothing is deleted. */
export function setProjectArchived(project: Project, archived: boolean): void {
  write((tx) => {
    tx.update(projects)
      .set({ archivedAt: archived ? new Date().toISOString() : null })
      .where(eq(projects.id, project.id))
      .run();
    enqueueMerged(tx, 'archive_project', lanes.project(project.id), project.id, { projectId: project.id, archived }, (_q, incoming) => incoming);
  });
}

/** Removes the project and everything in it, for everyone. Owner/Admin only; cannot be undone. */
export function deleteProject(project: Project): void {
  write((tx) => {
    const channelIds = tx
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.projectId, project.id))
      .all()
      .map((c) => c.id);
    const taskIds = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, project.id))
      .all()
      .map((t) => t.id);
    removeChannelsLocal(tx, channelIds);
    if (taskIds.length) tx.delete(taskHistory).where(inArray(taskHistory.taskId, taskIds)).run();
    tx.delete(tasks).where(eq(tasks.projectId, project.id)).run();
    tx.delete(projectMembers).where(eq(projectMembers.projectId, project.id)).run();
    tx.delete(projects).where(eq(projects.id, project.id)).run();
    enqueue(tx, 'delete_project', lanes.project(project.id), project.id, { projectId: project.id, name: project.name });
  });
}
