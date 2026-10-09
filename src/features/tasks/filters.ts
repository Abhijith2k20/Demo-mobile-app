// Task list filters. Pure functions, so they are easy to test.
import { addDays, format, parseISO } from 'date-fns';
import { isDone, taskVarianceDays } from '@/shared/taskRules';
import type { ID, Task, TaskStatus } from '@/types/models';

export type OwnerFilter = 'any' | 'me' | 'unassigned' | ID;
export type DueFilter = 'any' | 'overdue' | 'week' | 'month';

export interface TaskFilters {
  /** Empty = every status. */
  statuses: TaskStatus[];
  owner: OwnerFilter;
  due: DueFilter;
  /** Only tasks finishing later than their baseline. */
  delayed: boolean;
  /** Empty = every phase. */
  phases: string[];
}

export const NO_FILTERS: TaskFilters = { statuses: [], owner: 'any', due: 'any', delayed: false, phases: [] };

/** Everything that still needs work: the "Pending" quick filter. */
export const PENDING: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'done_pending_confirmation'];

export const isPendingOnly = (f: TaskFilters): boolean =>
  f.statuses.length === PENDING.length && PENDING.every((s) => f.statuses.includes(s));

/** How many filters are set beyond the two quick chips (shown on the Filters button). */
export function advancedCount(f: TaskFilters): number {
  let n = 0;
  if (f.statuses.length > 0 && !isPendingOnly(f)) n++;
  if (f.owner !== 'any' && f.owner !== 'me') n++;
  if (f.due !== 'any') n++;
  if (f.delayed) n++;
  if (f.phases.length > 0) n++;
  return n;
}

export const isFiltering = (f: TaskFilters): boolean =>
  f.statuses.length > 0 || f.owner !== 'any' || f.due !== 'any' || f.delayed || f.phases.length > 0;

export function matchesFilters(task: Task, f: TaskFilters, meId: ID, today: string): boolean {
  if (f.statuses.length > 0 && !f.statuses.includes(task.status)) return false;
  if (f.owner === 'me' && task.ownerId !== meId) return false;
  if (f.owner === 'unassigned' && task.ownerId !== null) return false;
  if (f.owner !== 'any' && f.owner !== 'me' && f.owner !== 'unassigned' && task.ownerId !== f.owner) return false;
  if (f.phases.length > 0 && !f.phases.includes(task.phase)) return false;
  if (f.delayed && !((taskVarianceDays(task) ?? 0) > 0 && !isDone(task.status))) return false;
  if (f.due !== 'any') {
    // Due filters are about work still to do; finished tasks never match.
    if (isDone(task.status)) return false;
    if (f.due === 'overdue') return task.plannedFinish < today;
    const until = format(addDays(parseISO(today), f.due === 'week' ? 7 : 30), 'yyyy-MM-dd');
    return task.plannedFinish >= today && task.plannedFinish <= until;
  }
  return true;
}
