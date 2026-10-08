// Activity items. Messages notify immediately; task changes are batched per recipient (§10.3).
import { uuidv7 } from 'uuidv7';
import type { Activity, ID, Task } from '@/types/models';
import { nowIso, projectManagers, store } from './db';
import { publish } from './events';

export const BATCH_MS = 10_000; // demo-shortened from 2 min

export const firstName = (userId: ID): string => store().users.get(userId)?.name.split(' ')[0] ?? 'Someone';
export const shortProject = (projectId: ID): string =>
  store().projects.get(projectId)?.name.split(' – ')[0] ?? 'the project';

export function addActivity(a: Omit<Activity, 'id' | 'createdAt'>): void {
  const s = store();
  if (a.userId === s.botId || a.userId === a.actorId) return;
  const activity: Activity = { ...a, id: uuidv7(), createdAt: nowIso() };
  s.activities.push(activity);
  publish({ type: 'activity.new', activity }, [a.userId]);
}

export type ChangeKind = 'dates' | 'progress' | 'status' | 'details';
interface Entry {
  task: Task;
  kind: ChangeKind;
  line: string;
}
interface Batch {
  recipient: ID;
  actor: ID;
  projectId: ID;
  entries: Entry[];
  timer: ReturnType<typeof setTimeout>;
}

const batches = new Map<string, Batch>();

function flush(key: string): void {
  const b = batches.get(key);
  if (!b) return;
  batches.delete(key);
  const tasks = new Map<ID, Task>();
  for (const e of b.entries) tasks.set(e.task.id, e.task);
  const kinds = new Set(b.entries.map((e) => e.kind));
  const what = kinds.size === 1 ? { dates: 'dates', progress: 'progress', status: 'status', details: 'details' }[b.entries[0].kind] : 'details';
  const actor = firstName(b.actor);
  const project = shortProject(b.projectId);
  const yours = [...tasks.values()].filter((t) => t.ownerId === b.recipient).length;
  const count = tasks.size;
  let text: string;
  if (count === 1) {
    text = `${actor} changed ${what} on ${b.entries[0].task.name}`;
  } else {
    text = `${actor} changed ${what} on ${count} tasks in ${project}`;
    if (yours > 0) text += ` · ${yours} ${yours === 1 ? 'is' : 'are'} yours`;
  }
  addActivity({
    userId: b.recipient,
    kind: 'task_changes',
    actorId: b.actor,
    projectId: b.projectId,
    channelId: null,
    messageId: null,
    taskIds: [...tasks.keys()],
    text,
    lines: b.entries.map((e) => `${e.task.name}: ${e.line}`),
  });
}

/** Queue one task change for the project's managers and the task owner. */
export function queueTaskChange(actorId: ID, task: Task, kind: ChangeKind, line: string): void {
  const recipients = new Set<ID>(projectManagers(task.projectId));
  if (task.ownerId) recipients.add(task.ownerId);
  recipients.delete(actorId);
  for (const recipient of recipients) {
    const key = `${recipient}|${actorId}|${task.projectId}`;
    let b = batches.get(key);
    if (!b) {
      b = {
        recipient,
        actor: actorId,
        projectId: task.projectId,
        entries: [],
        timer: setTimeout(() => flush(key), BATCH_MS),
      };
      batches.set(key, b);
    }
    b.entries.push({ task, kind, line });
  }
}

export function resetNotify(): void {
  for (const b of batches.values()) clearTimeout(b.timer);
  batches.clear();
}
