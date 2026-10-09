// In-memory store for the mock server. Resets on reload or "Reset demo".
import { isCompanyAdmin } from '@/shared/permissions';
import { MockError } from './http';
import type {
  Activity,
  Channel,
  ChannelMember,
  Checkin,
  ID,
  Message,
  Project,
  ProjectMember,
  ProjectRole,
  Task,
  TaskHistory,
  User,
} from '@/types/models';

export type StoredUser = User & { updatedAt: string; online: boolean };
export type StoredProjectMember = ProjectMember & { joinedAt: string };
export type StoredChannelMember = ChannelMember & { joinedAt: string };
export type StoredCheckin = Checkin & {
  messageId: ID;
  updatedAt: string;
  remindedAt: string | null;
  escalatedAt: string | null;
};
export type RemovalKind = 'projects' | 'channels' | 'tasks' | 'messages';

export interface MockStore {
  companyId: ID;
  botId: ID;
  users: Map<ID, StoredUser>;
  projects: Map<ID, Project>;
  projectMembers: StoredProjectMember[];
  channels: Map<ID, Channel>;
  channelMembers: StoredChannelMember[];
  messages: Map<ID, Message>;
  tasks: Map<ID, Task>;
  taskHistory: TaskHistory[];
  checkins: Map<ID, StoredCheckin>;
  activities: Activity[];
  uploads: Map<ID, { id: ID; userId: ID; uri: string | null; done: boolean }>;
  removals: { userId: ID; kind: RemovalKind; id: ID; at: string }[];
  tokens: Map<string, { userId: ID; kind: 'access' | 'refresh'; expired: boolean }>;
  otpAttempts: Map<string, number>;
}

// The seed builder is injected to avoid a circular import (seed needs these helpers).
let builder: (() => MockStore) | null = null;
let current: MockStore | null = null;

export function registerSeed(fn: () => MockStore): void {
  builder = fn;
}

export function resetStore(): void {
  if (!builder) throw new Error('seed not registered');
  current = builder();
}

export function store(): MockStore {
  if (!current) resetStore();
  return current as MockStore;
}

let lastTs = 0;
/** Strictly increasing server clock so `updatedAt` comparisons are never ambiguous. */
export function nowMs(): number {
  const t = Date.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}
export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}

// ---- Visibility helpers (who may see what) ----

export function projectRole(userId: ID, projectId: ID): ProjectRole | null {
  return store().projectMembers.find((m) => m.userId === userId && m.projectId === projectId)?.role ?? null;
}

export function canSeeProject(user: User, projectId: ID): boolean {
  return isCompanyAdmin(user) || projectRole(user.id, projectId) !== null;
}

export function isChannelMember(userId: ID, channelId: ID): boolean {
  return store().channelMembers.some((m) => m.userId === userId && m.channelId === channelId);
}

export function canSeeChannel(user: User, ch: Channel): boolean {
  if (ch.kind === 'dm' || ch.kind === 'bot') return isChannelMember(user.id, ch.id);
  if (ch.kind === 'company') return true;
  return isCompanyAdmin(user) || isChannelMember(user.id, ch.id);
}

export function humans(): StoredUser[] {
  const s = store();
  return [...s.users.values()].filter((u) => u.id !== s.botId && u.isActive);
}

export function admins(): ID[] {
  return humans()
    .filter((u) => isCompanyAdmin(u))
    .map((u) => u.id);
}

export function channelAudience(ch: Channel): ID[] {
  const s = store();
  const members = s.channelMembers.filter((m) => m.channelId === ch.id).map((m) => m.userId);
  if (ch.kind === 'dm' || ch.kind === 'bot') return members;
  if (ch.kind === 'company') return humans().map((u) => u.id);
  return [...new Set([...members, ...admins()])];
}

export function projectAudience(projectId: ID): ID[] {
  const members = store()
    .projectMembers.filter((m) => m.projectId === projectId)
    .map((m) => m.userId);
  return [...new Set([...members, ...admins()])];
}

export function projectManagers(projectId: ID): ID[] {
  return store()
    .projectMembers.filter((m) => m.projectId === projectId && m.role === 'manager')
    .map((m) => m.userId);
}

export function projectChannel(projectId: ID, name: string): Channel | undefined {
  return [...store().channels.values()].find((c) => c.projectId === projectId && c.name === name);
}

export function botChannelFor(userId: ID): Channel | undefined {
  const s = store();
  return [...s.channels.values()].find((c) => c.kind === 'bot' && isChannelMember(userId, c.id));
}

/** Ensures a membership row exists (admins get rows lazily for read markers). */
export function ensureChannelMember(userId: ID, channelId: ID): StoredChannelMember {
  const s = store();
  let row = s.channelMembers.find((m) => m.userId === userId && m.channelId === channelId);
  if (!row) {
    row = { channelId, userId, lastReadMessageId: null, joinedAt: nowIso() };
    s.channelMembers.push(row);
  }
  return row;
}

/** Archived projects are read-only: no new messages, no task changes. */
export function assertProjectActive(projectId: ID | null | undefined): void {
  if (!projectId) return;
  if (store().projects.get(projectId)?.archivedAt) {
    throw new MockError('PROJECT_ARCHIVED', 'This project is archived. Unarchive it to make changes.');
  }
}

export function logRemoval(userId: ID, kind: RemovalKind, id: ID): void {
  store().removals.push({ userId, kind, id, at: nowIso() });
}
