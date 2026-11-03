// Who is signed in and what they may do (all decided by the server).
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { get, keys } from '@/lib/queries';
import { useSession, type Me } from '@/stores/session';
import type { ID, User } from '@/types/models';
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

/** Keeps the signed-in user's profile and permissions current. */
export function useMeSync(): void {
  const q = useQuery({ queryKey: keys.me, queryFn: get<Me>('/me') });
  useEffect(() => {
    if (q.data && useSession.getState().user) useSession.getState().setMe(q.data);
  }, [q.data]);
}

export interface ProjectAccess {
  /** Owner or Admin: runs this project (its channels and people). */
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
    isAdmin: can('project.delete'),
    archived: !!project?.archivedAt,
    canArchive: can('project.archive'),
    can,
  };
}
