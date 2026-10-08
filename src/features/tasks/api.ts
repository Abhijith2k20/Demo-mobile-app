// Task and schedule writes. Local change + outbox item in one transaction (rule 1).
import { addDays, format, parseISO } from 'date-fns';
import { eq } from 'drizzle-orm';
import * as Haptics from 'expo-haptics';
import { uuidv7 } from 'uuidv7';
import { db } from '@/lib/db/client';
import { checkins, projects, tasks } from '@/lib/db/schema';
import { enqueue, write } from '@/lib/outbox/enqueue';
import { lanes } from '@/lib/outbox/lanes';
import { enqueueMerged } from '@/lib/outbox/merge';
import type { TaskCreate } from '@/shared/schemas';
import { isDone, normalizeTaskChange, todayIso, type TaskChanges } from '@/shared/taskRules';
import type { Checkin, CheckinAnswer, ID, Project, Stage, Task } from '@/types/models';
import { queueMessage } from '../chat/api';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

function pick(task: Task, keys: (keyof TaskChanges)[]): TaskChanges {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = task[k];
  return out as TaskChanges;
}

/**
 * Changes a task. Several unsent changes to the same task merge into one outbox item with the
 * final values (rule 3), so five quick edits offline become a single PATCH.
 */
export function updateTask(task: Task, input: TaskChanges, isManager: boolean, opts: { confirm?: boolean } = {}): void {
  const local = normalizeTaskChange(task, input, isManager);
  const keys = Object.keys(local) as (keyof TaskChanges)[];
  if (keys.length === 0 && !opts.confirm) return;
  // Send only what the user actually changed; the server works out the consequences itself.
  const sent: TaskChanges = {};
  for (const k of Object.keys(input) as (keyof TaskChanges)[]) {
    if (k !== 'actualStart' && k !== 'actualFinish' && input[k] !== task[k]) Object.assign(sent, { [k]: input[k] });
  }
  write((tx) => {
    tx.update(tasks).set(local).where(eq(tasks.id, task.id)).run();
    enqueueMerged(
      tx,
      'update_task',
      lanes.task(task.id),
      task.id,
      { taskId: task.id, name: task.name, input: sent, local, prev: pick(task, keys), confirm: opts.confirm },
      (queued, incoming) => ({
        ...queued,
        input: { ...queued.input, ...incoming.input },
        local: { ...queued.local, ...incoming.local },
        prev: { ...incoming.prev, ...queued.prev }, // keep the oldest "before" value per field
        confirm: queued.confirm || incoming.confirm,
      }),
    );
  });
  if (local.status && isDone(local.status)) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Manager confirms a Member's "done". */
export function confirmTask(task: Task): void {
  updateTask(task, { status: 'done' }, true, { confirm: true });
}

export function shiftTask(task: Task, days: number, isManager: boolean): void {
  const move = (d: string) => iso(addDays(parseISO(d), days));
  updateTask(task, { plannedStart: move(task.plannedStart), plannedFinish: move(task.plannedFinish) }, isManager);
}

/** Smart defaults for quick add: the day after the phase's last task ends, three days long. */
export function quickAddDefaults(all: Task[], phase: string): { plannedStart: string; plannedFinish: string } {
  const inPhase = all.filter((t) => t.phase === phase && !t.deletedAt);
  const lastFinish = inPhase.reduce((max, t) => (t.plannedFinish > max ? t.plannedFinish : max), '');
  const start = lastFinish ? addDays(parseISO(lastFinish), 1) : new Date();
  return { plannedStart: iso(start), plannedFinish: iso(addDays(start, 2)) };
}

export interface NewTaskInput {
  projectId: ID;
  name: string;
  phase: string;
  ownerId: ID | null;
  plannedStart: string;
  plannedFinish: string;
  description: string | null;
  channelId: ID | null;
}

/** Creates a task; optionally posts a task card in a channel (which waits for the task itself). */
export function createTask(input: NewTaskInput, opts: { cardChannelId?: ID } = {}): ID {
  const id = uuidv7();
  const payload: TaskCreate = {
    id,
    name: input.name.trim(),
    phase: input.phase,
    ownerId: input.ownerId,
    plannedStart: input.plannedStart,
    plannedFinish: input.plannedFinish,
    description: input.description,
    channelId: input.channelId,
  };
  write((tx) => {
    tx.insert(tasks)
      .values({
        ...payload,
        projectId: input.projectId,
        baselineStart: null,
        baselineFinish: null,
        actualStart: null,
        actualFinish: null,
        status: 'not_started',
        percent: 0,
        updatedAt: new Date(0).toISOString(),
        deletedAt: null,
      })
      .run();
    const item = enqueue(tx, 'create_task', lanes.task(id), id, { projectId: input.projectId, task: payload });
    if (opts.cardChannelId) {
      queueMessage(tx, { channelId: opts.cardChannelId, type: 'task_card', body: null, data: { taskId: id }, dependsOn: item });
    }
  });
  return id;
}

export function lockBaseline(project: Project, reason: string | null): void {
  write((tx) => {
    const list = tx.select().from(tasks).where(eq(tasks.projectId, project.id)).all();
    for (const t of list) {
      tx.update(tasks).set({ baselineStart: t.plannedStart, baselineFinish: t.plannedFinish }).where(eq(tasks.id, t.id)).run();
    }
    tx.update(projects).set({ baselineLocked: true, baselineFinish: project.plannedFinish }).where(eq(projects.id, project.id)).run();
    enqueue(tx, 'lock_baseline', lanes.project(project.id), project.id, { projectId: project.id, reason });
  });
}

export function moveStage(project: Project, stage: Stage): void {
  write((tx) => {
    tx.update(projects).set({ stage }).where(eq(projects.id, project.id)).run();
    enqueueMerged(
      tx,
      'project_stage',
      lanes.project(project.id),
      project.id,
      { projectId: project.id, stage, prevStage: project.stage },
      (queued, incoming) => ({ ...incoming, prevStage: queued.prevStage }),
    );
  });
}

/** Answers a bot check-in. The answer carries the check-in id, so repeating it is harmless. */
export function answerCheckin(checkin: Checkin, task: Task | null, answer: CheckinAnswer, isManager: boolean): void {
  const stamped: CheckinAnswer = { ...answer, at: new Date().toISOString() };
  const change: TaskChanges =
    answer.kind === 'progress'
      ? { percent: answer.percent ?? 0, status: 'in_progress' }
      : answer.kind === 'started'
        ? { status: 'in_progress' }
        : answer.kind === 'problem'
          ? { status: 'blocked' }
          : answer.kind === 'done'
            ? { status: 'done' }
            : {};
  const local = task ? normalizeTaskChange(task, change, isManager, todayIso()) : {};
  const keys = Object.keys(local) as (keyof TaskChanges)[];
  write((tx) => {
    tx.update(checkins).set({ answer: stamped }).where(eq(checkins.id, checkin.id)).run();
    if (task && keys.length) tx.update(tasks).set(local).where(eq(tasks.id, task.id)).run();
    enqueue(tx, 'checkin_answer', lanes.task(checkin.taskId), checkin.id, {
      checkinId: checkin.id,
      taskId: checkin.taskId,
      answer,
      local,
      prev: task ? pick(task, keys) : {},
    });
  });
  if (answer.kind === 'done') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function getTask(id: ID): Task | null {
  return db.select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
}
