// Project, member and channel writes. The server applies the rules (default channels,
// managers in every channel, one manager minimum, #general can't change…).
import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/api/client';
import { attempt, submit } from '@/lib/mutations';
import { keys } from '@/lib/queries';
import type { Channel, ChannelView, ID, JobTitle, Project, ProjectRole, ProjectView } from '@/types/models';

export interface ProjectDetails {
  name: string;
  client: string;
  address: string;
}

const projectKeys = (projectId: ID) => [keys.projects, keys.channels, keys.browse(projectId)];

/** Creates a project with its four channels. Field errors come back for the form. */
export function createProject(input: ProjectDetails) {
  return submit(() => api<ProjectView>('POST', '/projects', { id: uuidv7(), ...input }), [keys.projects, keys.channels]);
}

export function addMember(input: { projectId: ID; userId: ID; role: ProjectRole; jobTitle: JobTitle; channelIds: ID[] }): Promise<unknown> {
  const { projectId, ...body } = input;
  return attempt(() => api('POST', `/projects/${projectId}/members`, body), projectKeys(projectId));
}

export function updateMember(input: { projectId: ID; userId: ID; role: ProjectRole; jobTitle: JobTitle; channelIds: ID[] }): Promise<unknown> {
  const { projectId, userId, ...body } = input;
  return attempt(() => api('PATCH', `/projects/${projectId}/members/${userId}`, body), projectKeys(projectId));
}

export function removeMember(projectId: ID, userId: ID): Promise<unknown> {
  return attempt(() => api('DELETE', `/projects/${projectId}/members/${userId}`), projectKeys(projectId));
}

// ---- Project settings ----

export function updateProjectDetails(project: Project, changes: ProjectDetails) {
  return submit(() => api<ProjectView>('PATCH', `/projects/${project.id}`, changes), [keys.projects]);
}

export function createChannel(input: { projectId: ID; name: string; isPrivate: boolean; memberIds: ID[] }) {
  const { projectId, ...body } = input;
  return submit(
    async () => (await api<{ channel: ChannelView }>('POST', `/projects/${projectId}/channels`, { id: uuidv7(), ...body })).channel,
    projectKeys(projectId),
  );
}

export function updateChannel(channel: Channel, changes: { name?: string; isPrivate?: boolean; memberIds?: ID[] }) {
  return submit(
    async () => (await api<{ channel: ChannelView }>('PATCH', `/channels/${channel.id}`, changes)).channel,
    [...projectKeys(channel.projectId ?? ''), keys.channel(channel.id)],
  );
}

export function deleteChannel(channel: Channel): Promise<unknown> {
  return attempt(() => api('DELETE', `/channels/${channel.id}`), projectKeys(channel.projectId ?? ''));
}

/** Joins a public channel found in "Browse channels". */
export function joinChannel(channel: Channel): Promise<unknown> {
  return attempt(() => api('POST', `/channels/${channel.id}/join`), [...projectKeys(channel.projectId ?? ''), keys.channel(channel.id)]);
}

export function leaveChannel(channel: Channel): Promise<unknown> {
  return attempt(() => api('POST', `/channels/${channel.id}/leave`), projectKeys(channel.projectId ?? ''));
}

/** Archive makes the whole project read-only; unarchive brings it back. Nothing is deleted. */
export function setProjectArchived(project: Project, archived: boolean): Promise<unknown> {
  return attempt(() => api('PATCH', `/projects/${project.id}`, { archived }), projectKeys(project.id));
}

/** Removes the project and everything in it, for everyone. Owner/Admin only; cannot be undone. */
export function deleteProject(project: Project): Promise<unknown> {
  return attempt(() => api('DELETE', `/projects/${project.id}`), projectKeys(project.id));
}
