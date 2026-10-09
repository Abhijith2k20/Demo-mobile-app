import { can, canCompany, defaultChannelNames, isCompanyAdmin } from '@/shared/permissions';
import { memberAddSchema, memberPatchSchema, projectCreateSchema, projectPatchSchema } from '@/shared/schemas';
import { todayIso } from '@/shared/taskRules';
import type { Channel, ID, Project } from '@/types/models';
import { uuidv7 } from 'uuidv7';
import {
  admins,
  assertProjectActive,
  canSeeProject,
  channelAudience,
  logRemoval,
  nowIso,
  projectAudience,
  projectChannel,
  projectRole,
  store,
  type StoredUser,
} from '../db';
import { publish } from '../events';
import { forbidden, MockError, notFound, parse, route, type RouteDef } from '../http';
import { visibleProject } from '../access';
import { firstName } from '../notify';
import { postMessage } from './messages';

const STAGE_LABEL: Record<string, string> = {
  design: 'Design',
  approval: 'Approval',
  procurement: 'Procurement',
  execution: 'Execution',
  finishing: 'Finishing',
  handover: 'Handover',
};

function requireMembersPermission(user: StoredUser, project: Project): void {
  if (!can(user, 'project.members', { projectRole: projectRole(user.id, project.id) })) {
    throw forbidden('Only managers can manage members.');
  }
}

const projectChannels = (projectId: ID): Channel[] =>
  [...store().channels.values()].filter((c) => c.projectId === projectId);

/** Sets the member's channels inside a project to exactly `channelIds`. */
function setMemberChannels(projectId: ID, userId: ID, channelIds: ID[]): void {
  const s = store();
  const u = s.users.get(userId);
  const keepsAccess = u ? isCompanyAdmin(u) : false;
  for (const ch of projectChannels(projectId)) {
    const idx = s.channelMembers.findIndex((m) => m.channelId === ch.id && m.userId === userId);
    const want = channelIds.includes(ch.id);
    if (want && idx === -1) {
      s.channelMembers.push({ channelId: ch.id, userId, lastReadMessageId: null, joinedAt: nowIso() });
      publish({ type: 'channel.member_added', channelId: ch.id, userId }, [...channelAudience(ch), userId]);
    } else if (!want && idx !== -1 && !keepsAccess) {
      const audience = [...channelAudience(ch), userId];
      s.channelMembers.splice(idx, 1);
      logRemoval(userId, 'channels', ch.id);
      publish({ type: 'channel.member_removed', channelId: ch.id, userId }, audience);
    }
  }
}

export const projectRoutes: RouteDef[] = [
  route('PATCH', '/projects/:id', ({ user, params, body }) => {
    const project = visibleProject(user, params.id);
    const input = parse(projectPatchSchema, body);
    const role = projectRole(user.id, project.id);
    const { stage, archived, ...details } = input;
    if (archived !== undefined && archived !== !!project.archivedAt) {
      if (!can(user, 'project.edit', { projectRole: role })) throw forbidden('Only managers can archive a project.');
      project.archivedAt = archived ? nowIso() : null;
      project.updatedAt = nowIso();
      publish({ type: 'project.updated', project }, projectAudience(project.id));
      const home = projectChannel(project.id, 'general');
      if (home) {
        postMessage(home, store().botId, {
          type: 'system',
          body: `${firstName(user.id)} ${archived ? 'archived' : 'unarchived'} this project`,
        });
      }
    }
    if (project.archivedAt && (stage || Object.keys(details).length > 0)) assertProjectActive(project.id);
    if (Object.keys(details).length > 0) {
      if (!can(user, 'project.edit', { projectRole: role })) throw forbidden('Only managers can edit project details.');
      Object.assign(project, details);
      project.updatedAt = nowIso();
      if (!stage || stage === project.stage) publish({ type: 'project.updated', project }, projectAudience(project.id));
    }
    if (!stage || project.stage === stage) return project;
    if (!can(user, 'project.stage', { projectRole: role })) {
      throw forbidden('Only managers can move the project stage.');
    }
    project.stage = stage;
    project.updatedAt = nowIso();
    publish({ type: 'project.updated', project }, projectAudience(project.id));
    const general = projectChannel(project.id, 'general');
    if (general) {
      postMessage(general, store().botId, {
        type: 'system',
        body: `${firstName(user.id)} moved the project to ${STAGE_LABEL[stage]}`,
      });
    }
    return project;
  }),

  // Owner/Admin only: removes the project and everything in it, for everyone.
  route('DELETE', '/projects/:id', ({ user, params }) => {
    const s = store();
    const project = s.projects.get(params.id);
    if (!project) return { deleted: true }; // already gone: safe to repeat
    if (!canSeeProject(user, project.id)) throw notFound('Project');
    if (!isCompanyAdmin(user)) throw forbidden('Only the owner or an admin can delete a project.');
    const audience = projectAudience(project.id);
    const channelIds = new Set(projectChannels(project.id).map((c) => c.id));
    const taskIds = new Set([...s.tasks.values()].filter((t) => t.projectId === project.id).map((t) => t.id));
    for (const m of [...s.messages.values()]) if (channelIds.has(m.channelId)) s.messages.delete(m.id);
    for (const id of channelIds) s.channels.delete(id);
    s.channelMembers = s.channelMembers.filter((m) => !channelIds.has(m.channelId));
    for (const id of taskIds) s.tasks.delete(id);
    s.taskHistory = s.taskHistory.filter((h) => !taskIds.has(h.taskId));
    for (const c of [...s.checkins.values()]) if (taskIds.has(c.taskId)) s.checkins.delete(c.id);
    s.projectMembers = s.projectMembers.filter((m) => m.projectId !== project.id);
    s.projects.delete(project.id);
    for (const userId of audience) {
      logRemoval(userId, 'projects', project.id);
      for (const id of channelIds) logRemoval(userId, 'channels', id);
    }
    // No dedicated event for this in the planned API: a membership event makes everyone re-sync.
    const first = [...channelIds][0] ?? project.id;
    for (const userId of audience) publish({ type: 'channel.member_removed', channelId: first, userId }, [userId]);
    return { deleted: true };
  }),

  // Demo addition: Owner/Admin create a project with its four channels.
  route('POST', '/projects', ({ user, body }) => {
    const s = store();
    const input = parse(projectCreateSchema, body);
    const existing = s.projects.get(input.id);
    if (existing) return { project: existing };
    if (!canCompany(user, 'project.create')) throw forbidden('Only the owner or an admin can create projects.');
    const ts = nowIso();
    const project: Project = {
      id: input.id,
      companyId: s.companyId,
      name: input.name,
      client: input.client,
      address: input.address,
      stage: 'design',
      startDate: todayIso(),
      plannedFinish: todayIso(),
      baselineFinish: null,
      baselineLocked: false,
      archivedAt: null,
      updatedAt: ts,
    };
    s.projects.set(project.id, project);
    for (const name of ['general', 'design', 'site-work', 'qs']) {
      const ch: Channel = {
        id: uuidv7(),
        companyId: s.companyId,
        projectId: project.id,
        name,
        kind: 'project',
        isPrivate: name === 'qs',
        postingPolicy: 'everyone',
        updatedAt: ts,
      };
      s.channels.set(ch.id, ch);
      for (const adminId of admins()) {
        s.channelMembers.push({ channelId: ch.id, userId: adminId, lastReadMessageId: null, joinedAt: ts });
        publish({ type: 'channel.member_added', channelId: ch.id, userId: adminId }, admins());
      }
    }
    publish({ type: 'project.updated', project }, admins());
    return { project };
  }),

  route('POST', '/projects/:id/members', ({ user, params, body }) => {
    const s = store();
    const project = visibleProject(user, params.id);
    requireMembersPermission(user, project);
    const input = parse(memberAddSchema, body);
    const target = s.users.get(input.userId);
    if (!target || !target.isActive || target.id === s.botId) throw notFound('Person');
    const existing = s.projectMembers.find((m) => m.projectId === project.id && m.userId === target.id);
    if (existing) {
      existing.role = input.role;
      existing.jobTitle = input.jobTitle;
    } else {
      s.projectMembers.push({
        projectId: project.id,
        userId: target.id,
        role: input.role,
        jobTitle: input.jobTitle,
        joinedAt: nowIso(),
      });
    }
    const valid = projectChannels(project.id).map((c) => c.id);
    let channelIds = input.channelIds.filter((id) => valid.includes(id));
    if (channelIds.length === 0) {
      const names = defaultChannelNames(input.role, input.jobTitle);
      channelIds = projectChannels(project.id)
        .filter((c) => names.includes(c.name))
        .map((c) => c.id);
    }
    // Managers are in every channel of the project.
    if (input.role === 'manager') channelIds = valid;
    setMemberChannels(project.id, target.id, channelIds);
    project.updatedAt = nowIso();
    publish({ type: 'project.updated', project }, projectAudience(project.id));
    return { projectId: project.id, userId: target.id, role: input.role, jobTitle: input.jobTitle };
  }),

  route('PATCH', '/projects/:id/members/:userId', ({ user, params, body }) => {
    const s = store();
    const project = visibleProject(user, params.id);
    requireMembersPermission(user, project);
    const input = parse(memberPatchSchema, body);
    const member = s.projectMembers.find((m) => m.projectId === project.id && m.userId === params.userId);
    if (!member) throw notFound('Member');
    if (input.role === 'member' && member.role === 'manager') {
      const managers = s.projectMembers.filter((m) => m.projectId === project.id && m.role === 'manager');
      if (managers.length <= 1) {
        throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', {
          fields: { role: 'A project needs at least one manager' },
        });
      }
    }
    if (input.role) member.role = input.role;
    if (input.jobTitle) member.jobTitle = input.jobTitle;
    if (member.role === 'manager') {
      setMemberChannels(project.id, member.userId, projectChannels(project.id).map((c) => c.id));
    } else if (input.channelIds) {
      setMemberChannels(project.id, member.userId, input.channelIds);
    }
    project.updatedAt = nowIso();
    publish({ type: 'project.updated', project }, projectAudience(project.id));
    return { projectId: project.id, userId: member.userId, role: member.role, jobTitle: member.jobTitle };
  }),

  route('DELETE', '/projects/:id/members/:userId', ({ user, params }) => {
    const s = store();
    const project = visibleProject(user, params.id);
    requireMembersPermission(user, project);
    const idx = s.projectMembers.findIndex((m) => m.projectId === project.id && m.userId === params.userId);
    if (idx === -1) return { removed: true }; // already gone: safe to repeat
    const userId = params.userId;
    s.projectMembers.splice(idx, 1);
    // Removal ends access: channels go, then the project and its tasks. Messages stay.
    setMemberChannels(project.id, userId, []);
    const target = s.users.get(userId);
    if (target && !isCompanyAdmin(target)) {
      logRemoval(userId, 'projects', project.id);
      for (const t of s.tasks.values()) if (t.projectId === project.id) logRemoval(userId, 'tasks', t.id);
    }
    project.updatedAt = nowIso();
    publish({ type: 'project.updated', project }, projectAudience(project.id));
    return { removed: true };
  }),
];
