// Task and schedule writes. Progress and status updates and check-in answers go through the send
// queue; the rest need the connection. The server works out the consequences either way.
import * as Haptics from 'expo-haptics';
import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/api/client';
import { enqueue, type TaskChanges } from '@/lib/outbox';
import { attempt } from '@/lib/mutations';
import { keys } from '@/lib/queries';
import type { Checkin, CheckinAnswer, ID, Project, Stage, Task, TaskStatus } from '@/types/models';
import { sendMessage } from '../shared';

const taskKeys = (task: Pick<Task, 'id' | 'projectId'>) => [
  keys.task(task.id),
  keys.tasks(task.projectId),
  keys.myTasks,
  ['tasks-by-ids'],
  keys.projects,
];

const doneish = (s: TaskStatus | undefined) => s === 'done' || s === 'done_pending_confirmation';

/** Changes a task through the send queue (only fields that differ). The server works out the rest. */
export function updateTask(task: Task, input: TaskChanges): void {
  const changes: TaskChanges = {};
  for (const k of Object.keys(input) as (keyof TaskChanges)[]) {
    if (input[k] !== task[k]) Object.assign(changes, { [k]: input[k] });
  }
  if (Object.keys(changes).length === 0) return;
  if (doneish(changes.status) || changes.percent === 100) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  enqueue({ kind: 'task', taskId: task.id, projectId: task.projectId, taskName: task.name, changes });
}

/** Manager confirms a Member's "done". */
export function confirmTask(task: Task): Promise<Task | null> {
  return attempt(() => api<Task>('POST', `/tasks/${task.id}/confirm`), taskKeys(task));
}

/** Moves a task's start and finish together (managers). */
export function shiftTask(task: Task, days: number): Promise<Task | null> {
  return attempt(() => api<Task>('POST', `/tasks/${task.id}/shift?days=${days}`), taskKeys(task));
}

export interface NewTaskInput {
  projectId: ID;
  name: string;
  phase: string;
  ownerId: ID | null;
  /** Left out: the server picks them (after the phase's last task). */
  plannedStart?: string;
  plannedFinish?: string;
  description: string | null;
  channelId: ID | null;
}

/** Creates a task; optionally posts its card in a channel once the task exists. */
export async function createTask(input: NewTaskInput, opts: { cardChannelId?: ID } = {}): Promise<ID | null> {
  const task = await attempt(
    () =>
      api<Task>('POST', `/projects/${input.projectId}/tasks`, {
        id: uuidv7(),
        name: input.name.trim(),
        phase: input.phase,
        ownerId: input.ownerId,
        ...(input.plannedStart ? { plannedStart: input.plannedStart, plannedFinish: input.plannedFinish } : {}),
        description: input.description,
        channelId: input.channelId,
      }),
    [keys.tasks(input.projectId), keys.myTasks, keys.projects],
  );
  if (task && opts.cardChannelId) {
    sendMessage({ channelId: opts.cardChannelId, type: 'task_card', body: null, data: { taskId: task.id } });
  }
  return task?.id ?? null;
}

export function lockBaseline(project: Project, reason: string | null): Promise<unknown> {
  const path = reason ? `/projects/${project.id}/baseline/rebaseline` : `/projects/${project.id}/baseline/lock`;
  return attempt(() => api('POST', path, reason ? { reason } : undefined), [keys.projects, keys.tasks(project.id)]);
}

export function moveStage(project: Project, stage: Stage): Promise<unknown> {
  return attempt(() => api('PATCH', `/projects/${project.id}`, { stage }), [keys.projects]);
}

/** Answers a bot check-in through the send queue. The answer carries the check-in id, so repeating it is harmless. */
export function answerCheckin(checkin: Checkin, taskName: string, answer: CheckinAnswer): void {
  if (answer.kind === 'done') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  enqueue({ kind: 'checkin', checkinId: checkin.id, taskId: checkin.taskId, taskName, answer });
}
