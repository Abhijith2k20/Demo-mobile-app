import { eq } from 'drizzle-orm';
import { api } from '@/lib/api/client';
import { db } from '@/lib/db/client';
import { checkins, tasks } from '@/lib/db/schema';
import i18n, { errorText } from '@/lib/i18n';
import { applyIncoming, reapplyPending } from '@/lib/sync/applyIncoming';
import type { TaskChanges } from '@/shared/taskRules';
import { toast } from '@/stores/ui';
import type { Checkin, ID, Task } from '@/types/models';
import type { Handler } from '../types';

/** Puts the server's values back, then re-applies any other change still waiting (rule 6). */
function revertTask(taskId: ID, prev: TaskChanges): void {
  db.transaction((tx) => {
    tx.update(tasks).set(prev).where(eq(tasks.id, taskId)).run();
    reapplyPending(tx, {
      tasks: new Set([taskId]),
      messages: new Set(),
      readMarkers: false,
      projects: new Set(),
      checkins: new Set(),
    });
  });
}

export const createTask: Handler<'create_task'> = {
  async send(p) {
    const saved = await api<Task>('POST', `/projects/${p.projectId}/tasks`, p.task);
    return () => applyIncoming({ tasks: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    db.delete(tasks).where(eq(tasks.id, p.task.id)).run();
    toast(i18n.t('errors.taskNotSaved', { name: p.task.name, reason: errorText(error) }), 'danger');
  },
};

export const updateTask: Handler<'update_task'> = {
  async send(p) {
    let saved: Task | null = null;
    // Only changed fields, as absolute values: sending twice gives the same result (rule 4).
    if (Object.keys(p.input).length > 0) saved = await api<Task>('PATCH', `/tasks/${p.taskId}`, p.input);
    if (p.confirm) saved = await api<Task>('POST', `/tasks/${p.taskId}/confirm`);
    const result = saved;
    return () => {
      if (result) applyIncoming({ tasks: [result] });
    };
  },
  onPermanentFailure(p, _item, error) {
    revertTask(p.taskId, p.prev);
    toast(i18n.t('errors.taskNotSaved', { name: p.name, reason: errorText(error) }), 'danger');
  },
};

export const checkinAnswer: Handler<'checkin_answer'> = {
  async send(p) {
    // Carries the check-in id: answering twice changes nothing.
    const saved = await api<Checkin>('POST', `/checkins/${p.checkinId}/answer`, p.answer);
    return () => applyIncoming({ checkins: [saved] });
  },
  onPermanentFailure(p, _item, error) {
    db.update(checkins).set({ answer: null }).where(eq(checkins.id, p.checkinId)).run();
    revertTask(p.taskId, p.prev);
    toast(errorText(error), 'danger');
  },
};
