import type { Task } from '@/types/models';
import { advancedCount, isFiltering, isPendingOnly, matchesFilters, NO_FILTERS, PENDING, type TaskFilters } from '../filters';

const TODAY = '2026-10-09';
const ME = 'me';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    phase: 'Carpentry',
    name: 'Wardrobe',
    description: null,
    ownerId: ME,
    plannedStart: '2026-10-05',
    plannedFinish: '2026-10-12',
    baselineStart: null,
    baselineFinish: null,
    actualStart: null,
    actualFinish: null,
    status: 'in_progress',
    percent: 50,
    channelId: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}
const f = (over: Partial<TaskFilters>): TaskFilters => ({ ...NO_FILTERS, ...over });
const match = (t: Task, filters: TaskFilters) => matchesFilters(t, filters, ME, TODAY);

describe('matchesFilters', () => {
  it('shows everything when no filter is set', () => {
    expect(match(task(), NO_FILTERS)).toBe(true);
    expect(match(task({ status: 'done', ownerId: null }), NO_FILTERS)).toBe(true);
  });

  it('"Pending" hides finished work but keeps work waiting for confirmation', () => {
    const pending = f({ statuses: PENDING });
    expect(match(task({ status: 'done' }), pending)).toBe(false);
    expect(match(task({ status: 'done_pending_confirmation' }), pending)).toBe(true);
    expect(match(task({ status: 'blocked' }), pending)).toBe(true);
  });

  it('filters by owner: me, unassigned, or one person', () => {
    expect(match(task({ ownerId: 'other' }), f({ owner: 'me' }))).toBe(false);
    expect(match(task({ ownerId: null }), f({ owner: 'unassigned' }))).toBe(true);
    expect(match(task(), f({ owner: 'unassigned' }))).toBe(false);
    expect(match(task({ ownerId: 'ravi' }), f({ owner: 'ravi' }))).toBe(true);
    expect(match(task({ ownerId: null }), f({ owner: 'ravi' }))).toBe(false);
  });

  it('overdue means the finish date has passed and the task is not done', () => {
    expect(match(task({ plannedFinish: '2026-10-08' }), f({ due: 'overdue' }))).toBe(true);
    expect(match(task({ plannedFinish: TODAY }), f({ due: 'overdue' }))).toBe(false);
    expect(match(task({ plannedFinish: '2026-10-08', status: 'done' }), f({ due: 'overdue' }))).toBe(false);
  });

  it('"due this week" includes today and the next seven days, not later or earlier', () => {
    const week = f({ due: 'week' });
    expect(match(task({ plannedFinish: TODAY }), week)).toBe(true);
    expect(match(task({ plannedFinish: '2026-10-16' }), week)).toBe(true);
    expect(match(task({ plannedFinish: '2026-10-17' }), week)).toBe(false);
    expect(match(task({ plannedFinish: '2026-10-08' }), week)).toBe(false);
  });

  it('"delayed" needs a baseline, a later finish, and unfinished work', () => {
    const delayed = f({ delayed: true });
    expect(match(task({ baselineFinish: '2026-10-10' }), delayed)).toBe(true);
    expect(match(task(), delayed)).toBe(false);
    expect(match(task({ baselineFinish: '2026-10-12' }), delayed)).toBe(false);
    expect(match(task({ baselineFinish: '2026-10-10', status: 'done' }), delayed)).toBe(false);
  });

  it('filters by phase and combines filters with AND', () => {
    expect(match(task(), f({ phases: ['Painting'] }))).toBe(false);
    expect(match(task(), f({ phases: ['Painting', 'Carpentry'] }))).toBe(true);
    expect(match(task({ ownerId: 'other' }), f({ phases: ['Carpentry'], owner: 'me' }))).toBe(false);
  });
});

describe('filter summaries', () => {
  it('the quick chips are not counted as advanced filters', () => {
    expect(advancedCount(f({ owner: 'me', statuses: PENDING }))).toBe(0);
    expect(isPendingOnly(f({ statuses: PENDING }))).toBe(true);
    expect(isFiltering(f({ owner: 'me' }))).toBe(true);
    expect(isFiltering(NO_FILTERS)).toBe(false);
  });

  it('counts each advanced group once', () => {
    expect(advancedCount(f({ statuses: ['blocked'], owner: 'ravi', due: 'week', delayed: true, phases: ['Civil', 'Painting'] }))).toBe(5);
  });
});
