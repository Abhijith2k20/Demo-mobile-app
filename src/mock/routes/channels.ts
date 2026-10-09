// Project channels: browse, create, rename, public/private, members, join/leave, delete.
import { can, isCompanyAdmin } from '@/shared/permissions';
import { channelCreateSchema, channelPatchSchema } from '@/shared/schemas';
import type { Channel, ID, Project } from '@/types/models';
import {
  admins,
  channelAudience,
  isChannelMember,
  logRemoval,
  nowIso,
  projectAudience,
  projectManagers,
  projectRole,
  store,
  type StoredUser,
} from '../db';
import { visibleProject } from '../access';
import { publish } from '../events';
import { forbidden, MockError, notFound, parse, route, type RouteDef } from '../http';
import { firstName } from '../notify';
import { postMessage } from './messages';

/** The one channel every project keeps: it cannot be made private, renamed or deleted. */
const HOME_CHANNEL = 'general';

function projectChannelFor(user: StoredUser, id: ID): { channel: Channel; project: Project } {
  const channel = store().channels.get(id);
  if (!channel || channel.kind !== 'project' || !channel.projectId) throw notFound('Channel');
  const project = visibleProject(user, channel.projectId);
  // Private channels are invisible to project members who are not in them.
  if (channel.isPrivate && !isCompanyAdmin(user) && !isChannelMember(user.id, channel.id)) {
    const manager = can(user, 'channel.manage', { projectRole: projectRole(user.id, project.id) });
    if (!manager) throw notFound('Channel');
  }
  return { channel, project };
}

function requireManage(user: StoredUser, project: Project): void {
  if (!can(user, 'channel.manage', { projectRole: projectRole(user.id, project.id) })) {
    throw forbidden('Only managers can manage channels.');
  }
}

function assertNameFree(projectId: ID, name: string, exceptId?: ID): void {
  const taken = [...store().channels.values()].some((c) => c.projectId === projectId && c.name === name && c.id !== exceptId);
  if (taken) throw new MockError('CHANNEL_NAME_TAKEN', 'This project already has a channel with that name.', { fields: { name: 'Name already used' } });
}

const projectMemberIds = (projectId: ID): Set<ID> =>
  new Set(
    store()
      .projectMembers.filter((m) => m.projectId === projectId)
      .map((m) => m.userId),
  );

function addMember(channel: Channel, userId: ID): void {
  const s = store();
  if (isChannelMember(userId, channel.id)) return;
  s.channelMembers.push({ channelId: channel.id, userId, lastReadMessageId: null, joinedAt: nowIso() });
  publish({ type: 'channel.member_added', channelId: channel.id, userId }, [...channelAudience(channel), userId]);
}

function removeMember(channel: Channel, userId: ID): void {
  const s = store();
  const idx = s.channelMembers.findIndex((m) => m.channelId === channel.id && m.userId === userId);
  if (idx === -1) return;
  const audience = [...channelAudience(channel), userId];
  s.channelMembers.splice(idx, 1);
  const u = s.users.get(userId);
  // Owner/Admin keep seeing project channels, so there is nothing to remove on their phone.
  if (!u || !isCompanyAdmin(u)) logRemoval(userId, 'channels', channel.id);
  publish({ type: 'channel.member_removed', channelId: channel.id, userId }, audience);
}

/** Sets the channel's project members to exactly `ids` (Owner/Admin rows are left alone). */
function setMembers(channel: Channel, ids: ID[]): void {
  const s = store();
  const allowed = projectMemberIds(channel.projectId ?? '');
  // Managers are in every channel of their project (spec §9.3), so they are never removed.
  const want = new Set([...ids.filter((id) => allowed.has(id)), ...projectManagers(channel.projectId ?? '')]);
  const current = s.channelMembers.filter((m) => m.channelId === channel.id && allowed.has(m.userId)).map((m) => m.userId);
  for (const id of current) if (!want.has(id)) removeMember(channel, id);
  for (const id of want) addMember(channel, id);
}

export const channelRoutes: RouteDef[] = [
  // Every channel the user may know about in a project, with whether they are in it.
  route('GET', '/projects/:id/channels', ({ user, params }) => {
    const s = store();
    const project = visibleProject(user, params.id);
    const manager = can(user, 'channel.manage', { projectRole: projectRole(user.id, project.id) });
    const channels = [...s.channels.values()]
      .filter((c) => c.projectId === project.id)
      .filter((c) => !c.isPrivate || manager || isChannelMember(user.id, c.id))
      .map((c) => ({
        ...c,
        joined: isChannelMember(user.id, c.id),
        memberCount: s.channelMembers.filter((m) => m.channelId === c.id && projectMemberIds(project.id).has(m.userId)).length,
      }));
    return { channels };
  }),

  route('POST', '/projects/:id/channels', ({ user, params, body }) => {
    const s = store();
    const project = visibleProject(user, params.id);
    const input = parse(channelCreateSchema, body);
    const existing = s.channels.get(input.id);
    if (existing) return { channel: existing }; // idempotent by client id
    requireManage(user, project);
    assertNameFree(project.id, input.name);
    const ts = nowIso();
    const channel: Channel = {
      id: input.id,
      companyId: s.companyId,
      projectId: project.id,
      name: input.name,
      kind: 'project',
      isPrivate: input.isPrivate,
      postingPolicy: 'everyone',
      updatedAt: ts,
    };
    s.channels.set(channel.id, channel);
    const members = new Set(input.memberIds.filter((id) => projectMemberIds(project.id).has(id)));
    for (const id of [...members, ...projectManagers(project.id), ...admins()]) addMember(channel, id);
    postMessage(channel, s.botId, { type: 'system', body: `${firstName(user.id)} created #${channel.name}` });
    return { channel };
  }),

  route('PATCH', '/channels/:id', ({ user, params, body }) => {
    const { channel, project } = projectChannelFor(user, params.id);
    requireManage(user, project);
    const input = parse(channelPatchSchema, body);
    const home = channel.name === HOME_CHANNEL;
    if (input.name !== undefined && input.name !== channel.name) {
      if (home) throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { name: '#general cannot be renamed' } });
      assertNameFree(project.id, input.name, channel.id);
      channel.name = input.name;
    }
    if (input.isPrivate !== undefined && input.isPrivate !== channel.isPrivate) {
      if (home && input.isPrivate) {
        throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { isPrivate: '#general stays open to the whole project' } });
      }
      channel.isPrivate = input.isPrivate;
      postMessage(channel, store().botId, {
        type: 'system',
        body: `${firstName(user.id)} made this channel ${channel.isPrivate ? 'private' : 'public'}`,
      });
    }
    channel.updatedAt = nowIso();
    if (input.memberIds) setMembers(channel, input.memberIds);
    publish({ type: 'channel.updated', channel }, [...channelAudience(channel), ...projectAudience(project.id)]);
    return { channel };
  }),

  route('DELETE', '/channels/:id', ({ user, params }) => {
    const s = store();
    const channel = s.channels.get(params.id);
    if (!channel) return { deleted: true }; // already gone: safe to repeat
    const { project } = projectChannelFor(user, params.id);
    requireManage(user, project);
    if (channel.name === HOME_CHANNEL) {
      throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { name: '#general cannot be deleted' } });
    }
    const audience = channelAudience(channel);
    for (const m of [...s.messages.values()]) if (m.channelId === channel.id) s.messages.delete(m.id);
    for (const t of s.tasks.values()) if (t.channelId === channel.id) t.channelId = null;
    s.channelMembers = s.channelMembers.filter((m) => m.channelId !== channel.id);
    s.channels.delete(channel.id);
    for (const userId of audience) {
      logRemoval(userId, 'channels', channel.id);
      publish({ type: 'channel.member_removed', channelId: channel.id, userId }, [userId]);
    }
    return { deleted: true };
  }),

  // Anyone on the project can join a public channel; private ones are by invitation.
  route('POST', '/channels/:id/join', ({ user, params }) => {
    const channel = store().channels.get(params.id);
    if (!channel || channel.kind !== 'project' || !channel.projectId) throw notFound('Channel');
    visibleProject(user, channel.projectId);
    if (channel.isPrivate && !isChannelMember(user.id, channel.id)) {
      throw new MockError('CHANNEL_PRIVATE', 'This channel is private. Ask a manager to add you.');
    }
    addMember(channel, user.id);
    return { channel };
  }),

  route('POST', '/channels/:id/leave', ({ user, params }) => {
    const channel = store().channels.get(params.id);
    if (!channel || channel.kind !== 'project') return { left: true };
    if (channel.name === HOME_CHANNEL) {
      throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { name: 'Everyone stays in #general' } });
    }
    if (channel.projectId && projectManagers(channel.projectId).includes(user.id)) {
      throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields: { name: 'Managers stay in every channel' } });
    }
    removeMember(channel, user.id);
    return { left: true };
  }),
];
