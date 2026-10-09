import { eq } from 'drizzle-orm';
import { api } from '@/lib/api/client';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { errorText } from '@/lib/i18n';
import { applyIncoming } from '@/lib/sync/applyIncoming';
import { catchUp } from '@/lib/sync/catchup';
import { toast } from '@/stores/ui';
import type { Project } from '@/types/models';
import type { Handler } from '../types';

/** For changes that touch many rows: on a permanent "no", reload the server's truth. */
function resyncAfterFailure(error: Parameters<typeof errorText>[0]): void {
  toast(errorText(error), 'danger');
  void catchUp({ full: true });
}

export const projectStage: Handler<'project_stage'> = {
  async send(p) {
    const saved = await api<Project>('PATCH', `/projects/${p.projectId}`, { stage: p.stage });
    return () => applyIncoming({ projects: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    db.update(projects).set({ stage: p.prevStage }).where(eq(projects.id, p.projectId)).run();
    toast(errorText(error), 'danger');
  },
};

export const lockBaseline: Handler<'lock_baseline'> = {
  async send(p) {
    const saved = p.reason
      ? await api<Project>('POST', `/projects/${p.projectId}/baseline/rebaseline`, { reason: p.reason })
      : await api<Project>('POST', `/projects/${p.projectId}/baseline/lock`);
    return () => {
      applyIncoming({ projects: [saved] });
      void catchUp();
    };
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const memberAdd: Handler<'member_add'> = {
  async send(p) {
    await api('POST', `/projects/${p.projectId}/members`, {
      userId: p.userId,
      role: p.role,
      jobTitle: p.jobTitle,
      channelIds: p.channelIds,
    });
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const memberUpdate: Handler<'member_update'> = {
  async send(p) {
    await api('PATCH', `/projects/${p.projectId}/members/${p.userId}`, {
      role: p.role,
      jobTitle: p.jobTitle,
      channelIds: p.channelIds,
    });
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const memberRemove: Handler<'member_remove'> = {
  async send(p) {
    await api('DELETE', `/projects/${p.projectId}/members/${p.userId}`);
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const updateProject: Handler<'update_project'> = {
  async send(p) {
    const saved = await api<Project>('PATCH', `/projects/${p.projectId}`, p.changes);
    return () => applyIncoming({ projects: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    db.update(projects).set(p.prev).where(eq(projects.id, p.projectId)).run();
    toast(errorText(error), 'danger');
  },
};

export const archiveProject: Handler<'archive_project'> = {
  async send(p) {
    const saved = await api<Project>('PATCH', `/projects/${p.projectId}`, { archived: p.archived });
    return () => applyIncoming({ projects: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    db.update(projects)
      .set({ archivedAt: p.archived ? null : new Date().toISOString() })
      .where(eq(projects.id, p.projectId))
      .run();
    toast(errorText(error), 'danger');
  },
};

export const deleteProject: Handler<'delete_project'> = {
  async send(p) {
    await api('DELETE', `/projects/${p.projectId}`);
    return () => void catchUp();
  },
  // The project was already removed from the phone; bring the server's copy back.
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const createChannel: Handler<'create_channel'> = {
  async send(p) {
    await api('POST', `/projects/${p.projectId}/channels`, { id: p.id, name: p.name, isPrivate: p.isPrivate, memberIds: p.memberIds });
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const updateChannel: Handler<'update_channel'> = {
  async send(p) {
    await api('PATCH', `/channels/${p.channelId}`, { name: p.name, isPrivate: p.isPrivate, memberIds: p.memberIds });
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const deleteChannel: Handler<'delete_channel'> = {
  async send(p) {
    await api('DELETE', `/channels/${p.channelId}`);
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const joinChannel: Handler<'join_channel'> = {
  async send(p) {
    await api('POST', `/channels/${p.channelId}/${p.on ? 'join' : 'leave'}`);
    // Joining brings the channel's recent history with the next sync.
    return () => void catchUp();
  },
  onPermanentFailure: (_p, _item, error) => resyncAfterFailure(error),
};

export const createProject: Handler<'create_project'> = {
  async send(p) {
    const res = await api<{ project: Project }>('POST', '/projects', p);
    return () => {
      applyIncoming({ projects: [res.project] });
      void catchUp();
    };
  },
  onPermanentFailure(p, _item, error) {
    db.delete(projects).where(eq(projects.id, p.id)).run();
    toast(errorText(error), 'danger');
  },
};
