import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  ActivityKind,
  ChannelKind,
  CheckinAnswer,
  CompanyRole,
  ID,
  JobTitle,
  MessageStatus,
  MessageType,
  OutboxKind,
  ProjectRole,
  Stage,
  TaskStatus,
} from '@/types/models';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  companyRole: text('company_role').$type<CompanyRole>().notNull(),
  avatarColor: text('avatar_color').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  online: integer('online', { mode: 'boolean' }).notNull().default(false),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  name: text('name').notNull(),
  client: text('client').notNull(),
  address: text('address').notNull(),
  stage: text('stage').$type<Stage>().notNull(),
  startDate: text('start_date').notNull(),
  plannedFinish: text('planned_finish').notNull(),
  baselineFinish: text('baseline_finish'),
  baselineLocked: integer('baseline_locked', { mode: 'boolean' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').$type<ProjectRole>().notNull(),
    jobTitle: text('job_title').$type<JobTitle>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  projectId: text('project_id'),
  name: text('name').notNull(),
  kind: text('kind').$type<ChannelKind>().notNull(),
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull(),
  postingPolicy: text('posting_policy').$type<'everyone' | 'admins'>().notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const channelMembers = sqliteTable(
  'channel_members',
  {
    channelId: text('channel_id').notNull(),
    userId: text('user_id').notNull(),
    lastReadMessageId: text('last_read_message_id'),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').notNull(),
    senderId: text('sender_id').notNull(),
    type: text('type').$type<MessageType>().notNull(),
    body: text('body'),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    threadParentId: text('thread_parent_id'),
    reactions: text('reactions', { mode: 'json' }).$type<Record<string, ID[]>>().notNull(),
    status: text('status').$type<MessageStatus>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('messages_channel_created').on(t.channelId, t.createdAt), index('messages_thread').on(t.threadParentId)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    phase: text('phase').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: text('owner_id'),
    plannedStart: text('planned_start').notNull(),
    plannedFinish: text('planned_finish').notNull(),
    baselineStart: text('baseline_start'),
    baselineFinish: text('baseline_finish'),
    actualStart: text('actual_start'),
    actualFinish: text('actual_finish'),
    status: text('status').$type<TaskStatus>().notNull(),
    percent: integer('percent').notNull(),
    channelId: text('channel_id'),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('tasks_project_phase').on(t.projectId, t.phase)],
);

export const taskHistory = sqliteTable(
  'task_history',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    userId: text('user_id').notNull(),
    field: text('field').notNull(),
    from: text('from_value'),
    to: text('to_value'),
    via: text('via').$type<'app' | 'checkin' | 'system'>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('task_history_task').on(t.taskId)],
);

export const checkins = sqliteTable('checkins', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  userId: text('user_id').notNull(),
  askedAt: text('asked_at').notNull(),
  answer: text('answer', { mode: 'json' }).$type<CheckinAnswer | null>(),
});

export const activity = sqliteTable('activity', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind').$type<ActivityKind>().notNull(),
  actorId: text('actor_id').notNull(),
  projectId: text('project_id'),
  channelId: text('channel_id'),
  messageId: text('message_id'),
  taskIds: text('task_ids', { mode: 'json' }).$type<ID[]>().notNull(),
  text: text('text').notNull(),
  lines: text('lines', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: text('created_at').notNull(),
  /** Local only: when the user saw it. */
  readAt: text('read_at'),
});

export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<OutboxKind>().notNull(),
    lane: text('lane').notNull(),
    entityId: text('entity_id').notNull(),
    payload: text('payload').notNull(),
    dependsOn: text('depends_on'),
    status: text('status').$type<'pending' | 'sending' | 'failed'>().notNull(),
    attempts: integer('attempts').notNull(),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    lastErrorCode: text('last_error_code'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('outbox_status_next').on(t.status, t.nextAttemptAt), index('outbox_lane_created').on(t.lane, t.createdAt)],
);

export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
