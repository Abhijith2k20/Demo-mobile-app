// Hooks used by several features. Screens read through these, never from the DB directly.
import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '@/lib/db/client';
import { channels, outbox, projectMembers, projects, users } from '@/lib/db/schema';
import { can as canDo, isCompanyAdmin } from '@/shared/permissions';
import { useSession } from '@/stores/session';
import type { Channel, ID, JobTitle, OutboxItem, Project, ProjectMember, ProjectRole, Stage, User } from '@/types/models';

export function useMe(): User {
  const user = useSession((s) => s.user);
  if (!user) throw new Error('No session');
  return user;
}

export function useUsers(): { list: User[]; byId: Map<ID, User>; loading: boolean } {
  const { data, updatedAt } = useLiveQuery(db.select().from(users).orderBy(asc(users.name)));
  return useMemo(() => ({ list: data, byId: new Map(data.map((u) => [u.id, u])), loading: !updatedAt }), [data, updatedAt]);
}

export const firstName = (name: string | undefined): string => name?.split(' ')[0] ?? '';
export const shortProjectName = (name: string): string => name.split(' – ')[0];

export function useProjects(): { list: Project[]; byId: Map<ID, Project>; loading: boolean } {
  const { data, updatedAt } = useLiveQuery(db.select().from(projects).orderBy(asc(projects.name)));
  return useMemo(() => ({ list: data, byId: new Map(data.map((p) => [p.id, p])), loading: !updatedAt }), [data, updatedAt]);
}

export function useProject(id: ID | null | undefined): Project | null {
  const { data } = useLiveQuery(db.select().from(projects).where(eq(projects.id, id ?? '')), [id]);
  return data[0] ?? null;
}

export function useChannels(): { list: Channel[]; byId: Map<ID, Channel> } {
  const { data } = useLiveQuery(db.select().from(channels).orderBy(asc(channels.name)));
  return useMemo(() => ({ list: data, byId: new Map(data.map((c) => [c.id, c])) }), [data]);
}

export function useAllProjectMembers(): ProjectMember[] {
  return useLiveQuery(db.select().from(projectMembers)).data;
}

export interface ProjectAccess {
  role: ProjectRole | null;
  jobTitle: JobTitle | null;
  isManager: boolean;
  isAdmin: boolean;
  /** The project is archived (read-only). */
  archived: boolean;
  /** May archive / unarchive this project (works on an archived project too). */
  canArchive: boolean;
  can: (action: string) => boolean;
}

/** What the signed-in user may do in a project. The app hides controls; the server enforces. */
export function useProjectAccess(projectId: ID | null | undefined): ProjectAccess {
  const me = useMe();
  const { data } = useLiveQuery(db.select().from(projectMembers).where(eq(projectMembers.userId, me.id)), [me.id]);
  const mine = data.find((m) => m.projectId === projectId);
  const role = mine?.role ?? null;
  const project = useProject(projectId);
  const archived = !!project?.archivedAt;
  // An archived project is read-only: every control that changes it is hidden.
  const can = useCallback((action: string) => !archived && canDo(me, action, { projectRole: role }), [me, role, archived]);
  return {
    role,
    jobTitle: mine?.jobTitle ?? null,
    isAdmin: isCompanyAdmin(me),
    isManager: can('task.edit_any'),
    archived,
    canArchive: canDo(me, 'project.edit', { projectRole: role }),
    can,
  };
}

export function useOutbox(): OutboxItem[] {
  return useLiveQuery(db.select().from(outbox).orderBy(asc(outbox.createdAt), asc(outbox.id))).data;
}

/** Changes that still have to reach the server, without background housekeeping. */
export function useUnsentCount(): { waiting: number; failed: number } {
  const items = useOutbox();
  return useMemo(() => {
    const real = items.filter((i) => i.kind !== 'mark_read');
    return { waiting: real.filter((i) => i.status !== 'failed').length, failed: real.filter((i) => i.status === 'failed').length };
  }, [items]);
}

export function useStageLabel(): (stage: Stage) => string {
  const { t } = useTranslation();
  return useCallback(
    (stage: Stage) =>
      ({
        design: t('stage.design', 'Design'),
        approval: t('stage.approval', 'Approval'),
        procurement: t('stage.procurement', 'Procurement'),
        execution: t('stage.execution', 'Execution'),
        finishing: t('stage.finishing', 'Finishing'),
        handover: t('stage.handover', 'Handover'),
      })[stage],
    [t],
  );
}
