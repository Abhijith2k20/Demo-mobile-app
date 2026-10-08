import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { addDays, format } from 'date-fns';
import { useMemo } from 'react';
import { db } from '@/lib/db/client';
import { checkins, projectMembers, taskHistory, tasks, users } from '@/lib/db/schema';
import { isDone, todayIso } from '@/shared/taskRules';
import { PHASES, type Checkin, type ID, type ProjectMember, type Task, type TaskHistory, type User } from '@/types/models';
import { useMe } from '../shared';

export function useProjectTasks(projectId: ID | null | undefined): { tasks: Task[]; loading: boolean } {
  const q = useLiveQuery(
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId ?? ''), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.plannedStart), asc(tasks.plannedFinish), asc(tasks.id)),
    [projectId],
  );
  return { tasks: q.data, loading: !q.updatedAt };
}

export function useTask(id: ID | null | undefined): { task: Task | null; loading: boolean } {
  const q = useLiveQuery(db.select().from(tasks).where(eq(tasks.id, id ?? '')), [id]);
  return { task: q.data[0] ?? null, loading: !q.updatedAt };
}

export function useTasksByIds(ids: ID[]): Task[] {
  const key = ids.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => ids, [key]);
  return useLiveQuery(db.select().from(tasks).where(inArray(tasks.id, stable.length ? stable : [''])), [key]).data;
}

export function useTaskHistory(taskId: ID): TaskHistory[] {
  return useLiveQuery(
    db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId)).orderBy(desc(taskHistory.createdAt), desc(taskHistory.id)),
    [taskId],
  ).data;
}

export function useCheckin(id: ID | null | undefined): Checkin | null {
  return useLiveQuery(db.select().from(checkins).where(eq(checkins.id, id ?? '')), [id]).data[0] ?? null;
}

/** Phases in build order, then any custom ones the project uses. */
export function orderedPhases(list: Task[]): string[] {
  const known: string[] = [...PHASES];
  const present = new Set(list.map((t) => t.phase));
  const custom = [...present].filter((p) => !known.includes(p));
  return [...custom, ...known.filter((p) => present.has(p))];
}

export interface MyTasks {
  today: Task[];
  week: Task[];
  done: Task[];
  loading: boolean;
}

/** The worker's task home: what's on now, what's coming this week, what was finished recently. */
export function useMyTasks(): MyTasks {
  const me = useMe();
  const q = useLiveQuery(
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.ownerId, me.id), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.plannedFinish)),
    [me.id],
  );
  return useMemo(() => {
    const today = todayIso();
    const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const recent = format(addDays(new Date(), -14), 'yyyy-MM-dd');
    const open = q.data.filter((t) => !isDone(t.status));
    return {
      today: open.filter((t) => t.plannedStart <= today),
      week: open.filter((t) => t.plannedStart > today && t.plannedStart <= weekEnd),
      done: q.data.filter((t) => isDone(t.status) && (t.actualFinish ?? t.plannedFinish) >= recent).reverse(),
      loading: !q.updatedAt,
    };
  }, [q.data, q.updatedAt]);
}

export interface MemberRow {
  member: ProjectMember;
  user: User;
}

export function useProjectMembers(projectId: ID | null | undefined): MemberRow[] {
  const q = useLiveQuery(
    db
      .select({ member: projectMembers, user: users })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId ?? ''))
      .orderBy(asc(projectMembers.role), asc(users.name)),
    [projectId],
  );
  return q.data;
}
