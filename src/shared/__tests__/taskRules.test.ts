import type { Task } from '@/types/models';
import { normalizeTaskChange, projectDelayDays, taskVarianceDays } from '../taskRules';

const TODAY = '2026-10-09';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    phase: 'Carpentry',
    name: 'Wardrobe',
    description: null,
    ownerId: 'u1',
    plannedStart: '2026-10-05',
    plannedFinish: '2026-10-12',
    baselineStart: null,
    baselineFinish: null,
    actualStart: null,
    actualFinish: null,
    status: 'not_started',
    percent: 0,
    channelId: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

describe('normalizeTaskChange', () => {
  it('starts the task when a member reports first progress', () => {
    expect(normalizeTaskChange(task(), { percent: 25 }, false, TODAY)).toEqual({
      percent: 25,
      status: 'in_progress',
      actualStart: TODAY,
    });
  });

  it("a member's 100% waits for a manager to confirm", () => {
    const out = normalizeTaskChange(task({ status: 'in_progress', percent: 75, actualStart: '2026-10-05' }), { percent: 100 }, false, TODAY);
    expect(out).toEqual({ percent: 100, status: 'done_pending_confirmation', actualFinish: TODAY });
  });

  it("a manager's 100% is done straight away", () => {
    const out = normalizeTaskChange(task({ status: 'in_progress', percent: 75, actualStart: '2026-10-05' }), { percent: 100 }, true, TODAY);
    expect(out).toEqual({ percent: 100, status: 'done', actualFinish: TODAY });
  });

  it('marking done sets 100% even when only the status was changed', () => {
    const out = normalizeTaskChange(task({ status: 'in_progress', percent: 50, actualStart: '2026-10-05' }), { status: 'done' }, true, TODAY);
    expect(out).toEqual({ status: 'done', percent: 100, actualFinish: TODAY });
  });

  it('reopening a finished task clears its finish date and drops below 100%', () => {
    const done = task({ status: 'done', percent: 100, actualStart: '2026-10-05', actualFinish: '2026-10-08' });
    expect(normalizeTaskChange(done, { status: 'in_progress' }, true, TODAY)).toEqual({
      status: 'in_progress',
      percent: 90,
      actualFinish: null,
    });
  });

  it('going back to "not started" resets progress and the start date', () => {
    const started = task({ status: 'in_progress', percent: 50, actualStart: '2026-10-05' });
    expect(normalizeTaskChange(started, { status: 'not_started' }, true, TODAY)).toEqual({
      status: 'not_started',
      percent: 0,
      actualStart: null,
    });
  });

  it('drops values that do not change anything, so nothing is sent or logged for them', () => {
    const t = task({ status: 'in_progress', percent: 50, actualStart: '2026-10-05' });
    expect(normalizeTaskChange(t, { percent: 50, name: 'Wardrobe' }, true, TODAY)).toEqual({});
  });

  it('leaves date edits alone', () => {
    expect(normalizeTaskChange(task(), { plannedFinish: '2026-10-14' }, true, TODAY)).toEqual({ plannedFinish: '2026-10-14' });
  });
});

describe('variance against the baseline', () => {
  it('has no variance without a baseline', () => {
    expect(taskVarianceDays(task())).toBeNull();
  });

  it('counts days later than the baseline as positive', () => {
    expect(taskVarianceDays(task({ plannedFinish: '2026-10-16', baselineFinish: '2026-10-12' }))).toBe(4);
  });

  it('counts days earlier than the baseline as negative', () => {
    expect(taskVarianceDays(task({ plannedFinish: '2026-10-11', baselineFinish: '2026-10-12' }))).toBe(-1);
  });

  it('a project without a locked baseline is never "behind"', () => {
    expect(projectDelayDays({ plannedFinish: '2026-11-04', baselineFinish: '2026-10-31', baselineLocked: false })).toBe(0);
    expect(projectDelayDays({ plannedFinish: '2026-11-04', baselineFinish: '2026-10-31', baselineLocked: true })).toBe(4);
  });
});
