import type { Channel, JobTitle, ProjectRole, User } from '@/types/models';

export const PROJECT_PERMISSIONS = {
  manager: [
    'project.edit',
    'project.stage',
    'project.members',
    'channel.manage',
    'task.create',
    'task.edit_any',
    'task.update_for_others',
    'task.confirm',
    'task.baseline',
    'message.delete_any',
    'message.pin',
  ],
  member: ['task.create', 'task.update_own'],
} as const;

export type ProjectAction =
  | (typeof PROJECT_PERMISSIONS)['manager'][number]
  | (typeof PROJECT_PERMISSIONS)['member'][number];
export type CompanyAction = 'company.users' | 'project.create';

export function isCompanyAdmin(user: Pick<User, 'companyRole'>): boolean {
  return user.companyRole === 'owner' || user.companyRole === 'admin';
}

export function can(
  user: Pick<User, 'companyRole'>,
  action: string,
  ctx: { projectRole?: ProjectRole | null },
): boolean {
  if (isCompanyAdmin(user)) return true;
  return !!ctx.projectRole && (PROJECT_PERMISSIONS[ctx.projectRole] as readonly string[]).includes(action);
}

export function canCompany(user: Pick<User, 'companyRole'>, _action: CompanyAction): boolean {
  return isCompanyAdmin(user);
}

export function canPost(user: Pick<User, 'companyRole'>, channel: Pick<Channel, 'postingPolicy' | 'kind'>): boolean {
  if (channel.postingPolicy === 'admins') return isCompanyAdmin(user);
  return true;
}

/** §9.3 — default channel names joined for a role + job title. */
export function defaultChannelNames(role: ProjectRole, jobTitle: JobTitle): string[] {
  if (role === 'manager') return ['general', 'design', 'site-work', 'qs'];
  switch (jobTitle) {
    case 'Designer':
      return ['design', 'general'];
    case 'QS':
      return ['qs', 'general'];
    case 'Supervisor':
    case 'Worker':
      return ['site-work', 'general'];
    case 'Project Manager':
      return ['general', 'design', 'site-work'];
  }
}

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_WINDOW_MS = 60 * 60 * 1000;
