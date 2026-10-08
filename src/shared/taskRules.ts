// Task rules shared by the mock server (authoritative) and the app (optimistic updates).
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Project, Task, TaskStatus } from '@/types/models';

export type TaskChanges = Partial<
  Pick<
    Task,
    | 'name'
    | 'description'
    | 'phase'
    | 'ownerId'
    | 'plannedStart'
    | 'plannedFinish'
    | 'status'
    | 'percent'
    | 'actualStart'
    | 'actualFinish'
  >
>;

export const MEMBER_EDITABLE: (keyof TaskChanges)[] = ['status', 'percent'];
export const PERCENT_STEPS = [0, 25, 50, 75, 90, 100];

export const todayIso = (): string => format(new Date(), 'yyyy-MM-dd');

export const isDone = (s: TaskStatus): boolean => s === 'done' || s === 'done_pending_confirmation';

/**
 * Fills in the consequences of a change: percent ↔ status coupling, Members' "done" waiting
 * for a Manager, and actual start/finish dates.
 */
export function normalizeTaskChange(task: Task, input: TaskChanges, isManager: boolean, today = todayIso()): TaskChanges {
  const next: TaskChanges = { ...input };
  if (next.percent !== undefined && next.status === undefined) {
    if (next.percent >= 100) next.status = 'done';
    else if (next.percent > 0 && task.status === 'not_started') next.status = 'in_progress';
    else if (next.percent < 100 && isDone(task.status)) next.status = 'in_progress';
  }
  if (next.status === 'done' && !isManager) next.status = 'done_pending_confirmation';
  if (next.status !== undefined) {
    if (isDone(next.status)) next.percent = 100;
    else if (isDone(task.status) && next.percent === undefined) next.percent = 90;
    if (next.status === 'not_started' && next.percent === undefined) next.percent = 0;
    if (next.status !== 'not_started' && !task.actualStart) next.actualStart = today;
    if (next.status === 'not_started') next.actualStart = null;
    next.actualFinish = isDone(next.status) ? (task.actualFinish ?? today) : null;
  }
  // Drop no-ops so history and PATCH bodies only carry real changes.
  for (const key of Object.keys(next) as (keyof TaskChanges)[]) {
    if (next[key] === task[key]) delete next[key];
  }
  return next;
}

/** Positive = finishing later than baseline. Null when there is no baseline. */
export function taskVarianceDays(task: Pick<Task, 'plannedFinish' | 'baselineFinish'>): number | null {
  if (!task.baselineFinish) return null;
  return differenceInCalendarDays(parseISO(task.plannedFinish), parseISO(task.baselineFinish));
}

export function projectDelayDays(p: Pick<Project, 'plannedFinish' | 'baselineFinish' | 'baselineLocked'>): number {
  if (!p.baselineLocked || !p.baselineFinish) return 0;
  return differenceInCalendarDays(parseISO(p.plannedFinish), parseISO(p.baselineFinish));
}

export const shortDate = (iso: string): string => format(parseISO(iso), 'd MMM');
