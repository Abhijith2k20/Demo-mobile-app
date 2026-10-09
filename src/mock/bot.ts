// Siteline Bot (§8): check-ins, reminders, escalation, morning summary.
import { uuidv7 } from 'uuidv7';
import { isCompanyAdmin } from '@/shared/permissions';
import { isDone } from '@/shared/taskRules';
import type { CheckinAnswer, ID, Task } from '@/types/models';
import {
  botChannelFor,
  nowIso,
  projectChannel,
  projectManagers,
  store,
  type StoredCheckin,
} from './db';
import { publish } from './events';
import { addActivity, firstName, shortProject } from './notify';
import { postMessage } from './routes/messages';
import { applyTaskChanges } from './routes/tasks';

export const REMINDER_MS = 60_000; // demo timing
export const ESCALATION_MS = 60_000;

const timers = new Map<ID, ReturnType<typeof setTimeout>>();

function clearTimer(checkinId: ID): void {
  const t = timers.get(checkinId);
  if (t) clearTimeout(t);
  timers.delete(checkinId);
}

function openTasksFor(userId: ID): Task[] {
  return [...store().tasks.values()]
    .filter((t) => t.ownerId === userId && !t.deletedAt && !isDone(t.status) && !store().projects.get(t.projectId)?.archivedAt)
    .sort((a, b) => (a.plannedFinish < b.plannedFinish ? -1 : 1));
}

function schedule(checkin: StoredCheckin): void {
  clearTimer(checkin.id);
  if (checkin.answer || checkin.escalatedAt) return;
  timers.set(
    checkin.id,
    setTimeout(
      () => {
        const c = store().checkins.get(checkin.id);
        if (!c || c.answer) return;
        if (!c.remindedAt) remind(c);
        else escalate(c);
      },
      checkin.remindedAt ? ESCALATION_MS : REMINDER_MS,
    ),
  );
}

function remind(c: StoredCheckin): void {
  const ch = botChannelFor(c.userId);
  if (!ch) return;
  c.remindedAt = nowIso();
  postMessage(ch, store().botId, { type: 'checkin', body: null, data: { checkinId: c.id, taskId: c.taskId, reminder: true } });
  schedule(c);
}

function escalate(c: StoredCheckin): void {
  const s = store();
  const task = s.tasks.get(c.taskId);
  if (!task || c.escalatedAt) return;
  clearTimer(c.id);
  c.escalatedAt = nowIso();
  const ch = (task.channelId && s.channels.get(task.channelId)) || projectChannel(task.projectId, 'site-work');
  const text = `${firstName(c.userId)} hasn't updated ${task.name}.`;
  if (ch) {
    postMessage(ch, s.botId, {
      type: 'status_card',
      body: null,
      data: { kind: 'escalation', userId: c.userId, taskId: task.id, taskName: task.name, text },
    });
  }
  for (const userId of projectManagers(task.projectId)) {
    addActivity({
      userId,
      kind: 'escalation',
      actorId: c.userId,
      projectId: task.projectId,
      channelId: ch?.id ?? null,
      messageId: null,
      taskIds: [task.id],
      text,
      lines: [],
    });
  }
}

/** Start reminder clocks for check-ins that were waiting when the user signed in. */
export function onLogin(userId: ID): void {
  for (const c of store().checkins.values()) {
    if (c.userId === userId && !c.answer && !c.escalatedAt && !timers.has(c.id)) schedule(c);
  }
}

export function sendMorningSummary(userId: ID): void {
  const ch = botChannelFor(userId);
  if (!ch) return;
  const tasks = openTasksFor(userId).slice(0, 5);
  postMessage(ch, store().botId, {
    type: 'text',
    body: null,
    data: { kind: 'morning_summary', taskIds: tasks.map((t) => t.id) },
  });
}

/** Creates one check-in and its card in the user's bot DM. */
function createCheckin(userId: ID, task: Task, withReminder: boolean): void {
  const s = store();
  const ch = botChannelFor(userId);
  if (!ch) return;
  const ts = nowIso();
  const id = uuidv7();
  const message = postMessage(ch, s.botId, { type: 'checkin', body: null, data: { checkinId: id, taskId: task.id } });
  const checkin: StoredCheckin = {
    id,
    taskId: task.id,
    userId,
    askedAt: ts,
    answer: null,
    messageId: message.id,
    updatedAt: ts,
    remindedAt: null,
    escalatedAt: null,
  };
  s.checkins.set(id, checkin);
  const { messageId: _m, updatedAt: _u, remindedAt: _r, escalatedAt: _e, ...pub } = checkin;
  publish({ type: 'checkin.new', checkin: pub }, [userId]);
  if (withReminder) schedule(checkin);
}

export function sendEveningCheckin(userId: ID): void {
  const s = store();
  const ch = botChannelFor(userId);
  if (!ch) return;
  const open = new Set([...s.checkins.values()].filter((c) => c.userId === userId && !c.answer).map((c) => c.taskId));
  const task = openTasksFor(userId).find((t) => !open.has(t.id));
  if (!task) {
    postMessage(ch, s.botId, { type: 'text', body: null, data: { kind: 'no_open_tasks' } });
    return;
  }
  createCheckin(userId, task, true);
}

const RECENTLY_ASKED_MS = 12 * 60 * 60 * 1000;

/**
 * Opening the bot conversation: ask for the status of every open task the user owns.
 * Tasks already asked about in the last 12 hours are skipped, so reopening does not repeat them.
 * These cards carry no reminder timer, to keep a batch from flooding the project channel.
 */
export function askAboutOpenTasks(userId: ID): number {
  const s = store();
  const ch = botChannelFor(userId);
  if (!ch) return 0;
  const cutoff = Date.now() - RECENTLY_ASKED_MS;
  const recent = new Set(
    [...s.checkins.values()].filter((c) => c.userId === userId && Date.parse(c.askedAt) > cutoff).map((c) => c.taskId),
  );
  const tasks = openTasksFor(userId).filter((t) => !recent.has(t.id));
  if (tasks.length === 0) {
    // Say so once, rather than leaving an owner with no tasks looking at a silent chat.
    const hasAny = recent.size > 0 || [...s.messages.values()].some((m) => m.channelId === ch.id && m.data?.kind === 'no_open_tasks');
    if (!hasAny) postMessage(ch, s.botId, { type: 'text', body: null, data: { kind: 'no_open_tasks' } });
    return 0;
  }
  postMessage(ch, s.botId, { type: 'text', body: null, data: { kind: 'checkin_intro', count: tasks.length } });
  for (const task of tasks) createCheckin(userId, task, false);
  return tasks.length;
}

/** Demo panel: escalate the user's oldest unanswered check-in right now. */
export function triggerEscalation(userId: ID): boolean {
  const c = [...store().checkins.values()].find((x) => x.userId === userId && !x.answer && !x.escalatedAt);
  if (!c) return false;
  escalate(c);
  return true;
}

/** Applies a check-in answer: task update, history "via check-in", status card, activity. */
export function applyCheckinAnswer(c: StoredCheckin, answer: CheckinAnswer): void {
  const s = store();
  clearTimer(c.id);
  c.answer = { ...answer, at: nowIso() };
  c.updatedAt = nowIso();
  const task = s.tasks.get(c.taskId);
  if (!task) return;
  const who = s.users.get(c.userId);
  const isManager = projectManagers(task.projectId).includes(c.userId) || (!!who && isCompanyAdmin(who));
  if (answer.kind === 'progress') {
    applyTaskChanges(c.userId, task, { percent: answer.percent ?? task.percent, status: 'in_progress' }, 'checkin', isManager);
  } else if (answer.kind === 'started') {
    applyTaskChanges(c.userId, task, { status: 'in_progress' }, 'checkin', isManager);
  } else if (answer.kind === 'problem') {
    applyTaskChanges(c.userId, task, { status: 'blocked' }, 'checkin', isManager);
  } else if (answer.kind === 'done') {
    applyTaskChanges(c.userId, task, { status: 'done' }, 'checkin', isManager);
  }
  const ch = (task.channelId && s.channels.get(task.channelId)) || projectChannel(task.projectId, 'site-work');
  if (ch) {
    postMessage(ch, s.botId, {
      type: 'status_card',
      body: null,
      data: {
        kind: 'checkin',
        userId: c.userId,
        taskId: task.id,
        taskName: task.name,
        answer: c.answer,
        hasPhoto: !!answer.hasPhoto,
      },
    });
  }
  const what =
    answer.kind === 'progress'
      ? `to ${answer.percent}%`
      : answer.kind === 'problem'
        ? `— problem: ${answer.reason ?? 'needs attention'}`
        : answer.kind === 'done'
          ? 'as done'
          : answer.kind === 'not_started'
            ? 'as not started yet'
            : 'as started';
  for (const userId of projectManagers(task.projectId)) {
    addActivity({
      userId,
      kind: 'checkin_result',
      actorId: c.userId,
      projectId: task.projectId,
      channelId: ch?.id ?? null,
      messageId: null,
      taskIds: [task.id],
      text: `${firstName(c.userId)} updated ${task.name} ${what}`,
      lines: [shortProject(task.projectId)],
    });
  }
}

export function resetBot(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
