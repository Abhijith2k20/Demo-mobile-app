import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useOutbox } from '@/lib/outbox';
import { get, keys } from '@/lib/queries';
import type { Checkin, ID, TaskDefaults, TaskHistory, TaskList, TaskView } from '@/types/models';
import { filterQuery, NO_FILTERS, type TaskFilters } from './filters';

const EMPTY: TaskList = { tasks: [], total: 0, phases: [], phaseChoices: [], currentPhase: null, window: { from: '', to: '' } };

/** A project's schedule, filtered, grouped and counted by the server. */
export function useProjectTasks(projectId: ID | null | undefined, filters: TaskFilters = NO_FILTERS): TaskList & { loading: boolean; failed: boolean } {
  const query = filterQuery(filters);
  const q = useQuery({
    queryKey: [...keys.tasks(projectId ?? ''), query],
    queryFn: get<TaskList>(`/projects/${projectId}/tasks${query ? `?${query}` : ''}`),
    enabled: !!projectId,
    placeholderData: keepPreviousData, // keep the list on screen while a new filter loads
  });
  return { ...(q.data ?? EMPTY), loading: q.isPending && !q.isError, failed: q.isError && !q.data };
}

/** What a new task form starts with (the server picks the phase and dates). */
export function useTaskDefaults(projectId: ID | null | undefined, phase: string | null, enabled = true): TaskDefaults | undefined {
  return useQuery({
    queryKey: keys.taskDefaults(projectId ?? '', phase ?? ''),
    queryFn: get<TaskDefaults>(`/projects/${projectId}/task-defaults${phase ? `?phase=${encodeURIComponent(phase)}` : ''}`),
    enabled: !!projectId && enabled,
  }).data;
}

function useTaskQuery(id: ID | null | undefined) {
  return useQuery({
    queryKey: keys.task(id ?? ''),
    queryFn: get<{ task: TaskView; history: TaskHistory[] }>(`/tasks/${id}`),
    enabled: !!id,
  });
}

export function useTask(id: ID | null | undefined): { task: TaskView | null; loading: boolean } {
  const q = useTaskQuery(id);
  return { task: q.data?.task ?? null, loading: q.isPending && !!id };
}

export function useTasksByIds(ids: ID[]): TaskView[] {
  const key = ids.join(',');
  const q = useQuery({ queryKey: keys.tasksByIds(key), queryFn: get<{ tasks: TaskView[] }>(`/tasks?ids=${key}`), enabled: ids.length > 0 });
  return q.data?.tasks ?? [];
}

export function useTaskHistory(taskId: ID): TaskHistory[] {
  return useTaskQuery(taskId).data?.history ?? [];
}

export function useMyCheckins(): { checkins: Checkin[]; loading: boolean } {
  const q = useQuery({ queryKey: keys.checkins, queryFn: get<{ checkins: Checkin[] }>('/me/checkins') });
  const items = useOutbox((st) => st.items);
  // An answer still in the send queue shows as the user gave it, marked as sending.
  const checkins = useMemo(() => {
    const queued = new Map(items.flatMap((i) => (i.kind === 'checkin' && i.state !== 'failed' ? [[i.checkinId, { answer: i.answer, at: i.createdAt }] as const] : [])));
    return (q.data?.checkins ?? []).map((c) => {
      const mine = c.answer ? undefined : queued.get(c.id);
      return mine ? { ...c, answer: { ...mine.answer, at: mine.at }, sending: true } : c;
    });
  }, [q.data, items]);
  return { checkins, loading: q.isPending };
}

/** True while a change to this task waits in the send queue on this phone. */
export function useTaskSending(taskId: ID | null | undefined): boolean {
  return useOutbox((st) => st.items.some((i) => (i.kind === 'task' || i.kind === 'checkin') && i.state !== 'failed' && i.taskId === taskId));
}

export function useCheckin(id: ID | null | undefined): Checkin | null {
  const { checkins } = useMyCheckins();
  return checkins.find((c) => c.id === id) ?? null;
}

/** Phases in build order, then any custom ones the project uses. */
export interface MyTasks {
  today: TaskView[];
  week: TaskView[];
  done: TaskView[];
  loading: boolean;
  /** Couldn't load and nothing saved to show. */
  failed: boolean;
}

/** Someone's own task home, grouped by the server: on now, this week, recently finished. */
export function useMyTasks(): MyTasks {
  const q = useQuery({ queryKey: keys.myTasks, queryFn: get<Omit<MyTasks, 'loading'>>('/me/tasks') });
  return { today: q.data?.today ?? [], week: q.data?.week ?? [], done: q.data?.done ?? [], loading: q.isPending && !q.isError, failed: q.isError && !q.data };
}
