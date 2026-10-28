// What the schedule's filter controls hold. The server does the filtering (GET /projects/:id/tasks).
import type { ID, TaskStatus } from '@/types/models';

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

/** The filters as query parameters for the server; empty when nothing is set. */
export function filterQuery(f: TaskFilters): string {
  const q = new URLSearchParams();
  if (f.statuses.length) q.set('status', f.statuses.join(','));
  if (f.owner !== 'any') q.set('owner', f.owner);
  if (f.due !== 'any') q.set('due', f.due);
  if (f.delayed) q.set('delayed', 'true');
  if (f.phases.length) q.set('phase', f.phases.join(','));
  return q.toString();
}
