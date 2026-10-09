// Access checks shared by the route files.
import type { ID, Project } from '@/types/models';
import { canSeeProject, store, type StoredUser } from './db';
import { notFound } from './http';

/** The project, or a 404 when the user may not see it (hidden resources are never a 403). */
export function visibleProject(user: StoredUser, id: ID): Project {
  const p = store().projects.get(id);
  if (!p || !canSeeProject(user, id)) throw notFound('Project');
  return p;
}
