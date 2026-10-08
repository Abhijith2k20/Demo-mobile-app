import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db } from '@/lib/db/client';
import { channelMembers, channels, projectMembers, projects } from '@/lib/db/schema';
import { enqueue, write } from '@/lib/outbox/enqueue';
import { lanes } from '@/lib/outbox/lanes';
import { enqueueMerged } from '@/lib/outbox/merge';
import { todayIso } from '@/shared/taskRules';
import type { ID, JobTitle, ProjectRole } from '@/types/models';

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
    if (projectChannelIds.length) {
      tx.delete(channelMembers)
        .where(and(eq(channelMembers.userId, input.userId), inArray(channelMembers.channelId, projectChannelIds)))
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
