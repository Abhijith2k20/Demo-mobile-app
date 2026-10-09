import { uuidv7 } from 'uuidv7';
import { can } from '@/shared/permissions';
import { rebaselineSchema, taskCreateSchema, taskPatchSchema } from '@/shared/schemas';
import { MEMBER_EDITABLE, normalizeTaskChange, shortDate, type TaskChanges } from '@/shared/taskRules';
import type { ID, Project, Task, TaskHistory } from '@/types/models';
import { assertProjectActive, canSeeProject, nowIso, projectAudience, projectChannel, projectRole, store, type StoredUser } from '../db';
import { publish } from '../events';
import { forbidden, MockError, notFound, parse, route, type RouteDef } from '../http';
import { addActivity, firstName, queueTaskChange, type ChangeKind } from '../notify';
import { postMessage } from './messages';

function visibleProject(user: StoredUser, id: ID): Project {
  const p = store().projects.get(id);
  if (!p || !canSeeProject(user, id)) throw notFound('Project');
  return p;
}

function visibleTask(user: StoredUser, id: ID): Task {
  const t = store().tasks.get(id);
  if (!t || t.deletedAt || !canSeeProject(user, t.projectId)) throw notFound('Task');
  return t;
}

/** Keeps the project's planned finish equal to its latest task finish. */
export function recomputeProject(projectId: ID): void {
  const s = store();
  const p = s.projects.get(projectId);
  if (!p) return;
  let max = '';
  for (const t of s.tasks.values()) {
    if (t.projectId === projectId && !t.deletedAt && t.plannedFinish > max) max = t.plannedFinish;
  }
  if (max && max !== p.plannedFinish) {
    p.plannedFinish = max;
    p.updatedAt = nowIso();
    publish({ type: 'project.updated', project: p }, projectAudience(projectId));
  }
}

function describe(field: string, from: string | null, to: string | null): { kind: ChangeKind; line: string } {
  switch (field) {
    case 'plannedStart':
      return { kind: 'dates', line: `start ${from ? shortDate(from) : '—'} → ${to ? shortDate(to) : '—'}` };
    case 'plannedFinish':
      return { kind: 'dates', line: `finish ${from ? shortDate(from) : '—'} → ${to ? shortDate(to) : '—'}` };
    case 'percent':
      return { kind: 'progress', line: `progress ${from}% → ${to}%` };
    case 'status':
      return { kind: 'status', line: `status → ${(to ?? '').replace(/_/g, ' ')}` };
    default:
      return { kind: 'details', line: `${field} changed` };
  }
}

/** Applies already-authorised changes: history per field, event, batched notification. */
export function applyTaskChanges(
  actorId: ID,
  task: Task,
  input: TaskChanges,
  via: TaskHistory['via'],
  isManager: boolean,
): Task {
  const s = store();
  const changes = normalizeTaskChange(task, input, isManager);
  const start = changes.plannedStart ?? task.plannedStart;
  const finish = changes.plannedFinish ?? task.plannedFinish;
  if (finish < start) {
    throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', {
      fields: { plannedFinish: 'Finish must be on or after start' },
    });
  }
  const keys = Object.keys(changes) as (keyof TaskChanges)[];
  if (keys.length === 0) return task;
  const ts = nowIso();
  const history: TaskHistory[] = [];
  const previousOwner = task.ownerId;
  for (const key of keys) {
    const from = task[key];
    const to = changes[key];
    if (key !== 'actualStart' && key !== 'actualFinish') {
      const entry: TaskHistory = {
        id: uuidv7(),
        taskId: task.id,
        userId: actorId,
        field: key,
        from: from === null || from === undefined ? null : String(from),
        to: to === null || to === undefined ? null : String(to),
        via,
        createdAt: ts,
      };
      history.push(entry);
      s.taskHistory.push(entry);
      if (key !== 'ownerId') {
        const d = describe(key, entry.from, entry.to);
        queueTaskChange(actorId, task, d.kind, d.line);
      }
    }
  }
  Object.assign(task, changes);
  task.updatedAt = ts;
  publish({ type: 'task.updated', task, history }, projectAudience(task.projectId));
  if (changes.ownerId && changes.ownerId !== previousOwner) {
    addActivity({
      userId: changes.ownerId,
      kind: 'task_assigned',
      actorId,
      projectId: task.projectId,
      channelId: task.channelId,
      messageId: null,
      taskIds: [task.id],
      text: `${firstName(actorId)} assigned you ${task.name}`,
      lines: [],
    });
  }
  if (changes.plannedFinish) recomputeProject(task.projectId);
  return task;
}

function requireBaselinePermission(user: StoredUser, project: Project): void {
  if (!can(user, 'task.baseline', { projectRole: projectRole(user.id, project.id) })) {
    throw forbidden('Only managers can lock the baseline.');
  }
}

function setBaseline(project: Project): void {
  const s = store();
  const ts = nowIso();
  let max = '';
  for (const t of s.tasks.values()) {
    if (t.projectId !== project.id || t.deletedAt) continue;
    t.baselineStart = t.plannedStart;
    t.baselineFinish = t.plannedFinish;
    t.updatedAt = ts;
    if (t.plannedFinish > max) max = t.plannedFinish;
    publish({ type: 'task.updated', task: t, history: [] }, projectAudience(project.id));
  }
  project.baselineLocked = true;
  project.baselineFinish = max || project.plannedFinish;
  project.updatedAt = nowIso();
  publish({ type: 'project.updated', project }, projectAudience(project.id));
}

export const taskRoutes: RouteDef[] = [
  route('POST', '/projects/:id/tasks', ({ user, params, body }) => {
    const s = store();
    const project = visibleProject(user, params.id);
    const input = parse(taskCreateSchema, body);
    const existing = s.tasks.get(input.id);
    if (existing) return existing;
    assertProjectActive(project.id);
    if (!can(user, 'task.create', { projectRole: projectRole(user.id, project.id) })) throw forbidden();
    if (input.ownerId && !s.projectMembers.some((m) => m.projectId === project.id && m.userId === input.ownerId)) {
      throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', {
        fields: { ownerId: 'Pick someone on this project' },
      });
    }
    const ts = nowIso();
    const task: Task = {
      id: input.id,
      projectId: project.id,
      phase: input.phase,
      name: input.name,
      description: input.description,
      ownerId: input.ownerId,
      plannedStart: input.plannedStart,
      plannedFinish: input.plannedFinish,
      // Tasks added after the baseline is locked are new scope: no baseline of their own.
      baselineStart: null,
      baselineFinish: null,
      actualStart: null,
      actualFinish: null,
      status: 'not_started',
      percent: 0,
      channelId: input.channelId ?? projectChannel(project.id, 'site-work')?.id ?? null,
      updatedAt: ts,
      deletedAt: null,
    };
    s.tasks.set(task.id, task);
    const history: TaskHistory = {
      id: uuidv7(),
      taskId: task.id,
      userId: user.id,
      field: 'created',
      from: null,
      to: task.name,
      via: 'app',
      createdAt: ts,
    };
    s.taskHistory.push(history);
    publish({ type: 'task.created', task, history: [history] }, projectAudience(project.id));
    if (task.ownerId) {
      addActivity({
        userId: task.ownerId,
        kind: 'task_assigned',
        actorId: user.id,
        projectId: project.id,
        channelId: task.channelId,
        messageId: null,
        taskIds: [task.id],
        text: `${firstName(user.id)} assigned you ${task.name}`,
        lines: [],
      });
    }
    recomputeProject(project.id);
    return task;
  }),

  route('PATCH', '/tasks/:id', ({ user, params, body }) => {
    const task = visibleTask(user, params.id);
    const input = parse(taskPatchSchema, body);
    assertProjectActive(task.projectId);
    const role = projectRole(user.id, task.projectId);
    const isManager = can(user, 'task.edit_any', { projectRole: role });
    if (!isManager) {
      const keys = Object.keys(input) as (keyof TaskChanges)[];
      const onlyProgress = keys.every((k) => MEMBER_EDITABLE.includes(k));
      if (!onlyProgress) throw forbidden('Only managers can change dates and details.');
      if (task.ownerId !== user.id || !can(user, 'task.update_own', { projectRole: role })) {
        throw forbidden('You can only update your own tasks.');
      }
    }
    return applyTaskChanges(user.id, task, input, 'app', isManager);
  }),

  route('POST', '/tasks/:id/confirm', ({ user, params }) => {
    const task = visibleTask(user, params.id);
    if (!can(user, 'task.confirm', { projectRole: projectRole(user.id, task.projectId) })) {
      throw forbidden('Only managers can confirm a task.');
    }
    if (task.status === 'done') return task;
    return applyTaskChanges(user.id, task, { status: 'done' }, 'app', true);
  }),

  route('POST', '/projects/:id/baseline/lock', ({ user, params }) => {
    const project = visibleProject(user, params.id);
    requireBaselinePermission(user, project);
    if (project.baselineLocked) {
      throw new MockError('TASK_BASELINE_LOCKED', 'The baseline is already locked. Re-baseline with a reason.');
    }
    setBaseline(project);
    const general = projectChannel(project.id, 'general');
    if (general) {
      postMessage(general, store().botId, { type: 'system', body: `${firstName(user.id)} locked the baseline` });
    }
    return project;
  }),

  route('POST', '/projects/:id/baseline/rebaseline', ({ user, params, body }) => {
    const project = visibleProject(user, params.id);
    requireBaselinePermission(user, project);
    const { reason } = parse(rebaselineSchema, body);
    setBaseline(project);
    const general = projectChannel(project.id, 'general');
    if (general) {
      postMessage(general, store().botId, {
        type: 'system',
        body: `${firstName(user.id)} re-baselined the schedule · Reason: ${reason}`,
      });
    }
    return project;
  }),
];
