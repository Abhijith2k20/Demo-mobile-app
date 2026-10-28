// Who is signed in and what they may do (all decided by the server).
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { get, keys } from '@/lib/queries';
import { useSession } from '@/stores/session';
import type { ID, JobTitle, ProjectRole, User } from '@/types/models';
import { useProject } from './data';

export function useMe(): User {
  const user = useSession((s) => s.user);
  if (!user) throw new Error('No session');
  return user;
}

/** Company-level permission from the server, e.g. 'project.create', 'user.invite'. */
export function useCan(): (action: string) => boolean {
  const permissions = useSession((s) => s.permissions);
  return useCallback((action: string) => permissions.includes(action), [permissions]);
}

/** Keeps the signed-in user's profile, permissions and layout mode current. */
export function useMeSync(): void {
  const q = useQuery({ queryKey: keys.me, queryFn: get<{ user: User; permissions: string[]; simpleMode: boolean }>('/me') });
  useEffect(() => {
    if (q.data && useSession.getState().user) useSession.getState().setMe(q.data);
  }, [q.data]);
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

/** What the signed-in user may do in a project, exactly as the server says. The app only hides. */
export function useProjectAccess(projectId: ID | null | undefined): ProjectAccess {
  const project = useProject(projectId);
  const permissions = project?.access.permissions;
  const can = useCallback((action: string) => !!permissions?.includes(action), [permissions]);
  return {
    role: project?.access.role ?? null,
    jobTitle: project?.access.jobTitle ?? null,
    isAdmin: can('project.delete'),
    isManager: can('task.edit_any'),
    archived: !!project?.archivedAt,
    canArchive: can('project.archive'),
    can,
  };
}
