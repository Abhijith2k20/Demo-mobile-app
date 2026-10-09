export type ID = string; // UUIDv7

export type CompanyRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'manager' | 'member';
export type JobTitle = 'Project Manager' | 'Designer' | 'QS' | 'Supervisor' | 'Worker';
export type Stage = 'design' | 'approval' | 'procurement' | 'execution' | 'finishing' | 'handover';

export const STAGES: Stage[] = ['design', 'approval', 'procurement', 'execution', 'finishing', 'handover'];
export const PHASES = [
  'Civil',
  'Electrical',
  'Plumbing',
  'False ceiling',
  'Carpentry',
  'Painting',
  'Finishing',
  'Handover',
] as const;

export interface User {
  id: ID;
  name: string;
  phone: string;
  companyRole: CompanyRole;
  avatarColor: string;
  isActive: boolean;
  /** Presence from the mock (demo addition). */
  online?: boolean;
}

export interface Project {
  id: ID;
  companyId: ID;
  name: string;
  client: string;
  address: string;
  stage: Stage;
  startDate: string;
  plannedFinish: string;
  baselineFinish: string | null;
  baselineLocked: boolean;
  /** Set when the project is archived: everything in it becomes read-only. */
  archivedAt: string | null;
  updatedAt: string;
}

export interface ProjectMember {
  projectId: ID;
  userId: ID;
  role: ProjectRole;
  jobTitle: JobTitle;
}

export type ChannelKind = 'project' | 'company' | 'dm' | 'bot';
export interface Channel {
  id: ID;
  companyId: ID;
  projectId: ID | null;
  name: string;
  kind: ChannelKind;
  isPrivate: boolean;
  postingPolicy: 'everyone' | 'admins';
  updatedAt: string;
}

export interface ChannelMember {
  channelId: ID;
  userId: ID;
  lastReadMessageId: ID | null;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'file'
  | 'task_card'
  | 'checkin'
  | 'issue_card'
  | 'daily_report'
  | 'status_card'
  | 'system';

export type MessageStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface Message {
  id: ID;
  channelId: ID;
  senderId: ID;
  type: MessageType;
  body: string | null;
  data: Record<string, unknown> | null;
  threadParentId: ID | null;
  reactions: Record<string, ID[]>;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'done_pending_confirmation';

export interface Task {
  id: ID;
  projectId: ID;
  phase: string;
  name: string;
  description: string | null;
  ownerId: ID | null;
  plannedStart: string;
  plannedFinish: string;
  baselineStart: string | null;
  baselineFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  status: TaskStatus;
  percent: number;
  channelId: ID | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TaskHistory {
  id: ID;
  taskId: ID;
  userId: ID;
  field: string;
  from: string | null;
  to: string | null;
  via: 'app' | 'checkin' | 'system';
  createdAt: string;
}

export interface CheckinAnswer {
  kind: 'started' | 'progress' | 'problem' | 'done' | 'not_started';
  percent?: number;
  reason?: string;
  note?: string;
  /** Length of an attached voice note, in seconds. */
  voiceSec?: number;
  hasPhoto?: boolean;
  at?: string;
}

export interface Checkin {
  id: ID;
  taskId: ID;
  userId: ID;
  askedAt: string;
  answer: null | CheckinAnswer;
}

// ---- Additions beyond the spec's model list (see DECISIONS.md) ----

export type PhotoTone = 'plywood' | 'concrete' | 'tile' | 'sage';

export interface Attachment {
  id: ID;
  kind: 'image';
  /** Local file URI for real photos; null for seeded placeholder tiles. */
  uri: string | null;
  uploadId: ID | null;
  caption?: string;
  tone?: PhotoTone;
}

export type ActivityKind =
  | 'mention'
  | 'thread_reply'
  | 'task_assigned'
  | 'task_changes'
  | 'checkin_result'
  | 'escalation';

export interface Activity {
  id: ID;
  userId: ID;
  kind: ActivityKind;
  actorId: ID;
  projectId: ID | null;
  channelId: ID | null;
  messageId: ID | null;
  taskIds: ID[];
  text: string;
  /** Lines shown when a batched item is expanded. */
  lines: string[];
  createdAt: string;
}

// ---- Outbox ----

export type OutboxKind =
  | 'send_message'
  | 'edit_message'
  | 'delete_message'
  | 'set_reaction'
  | 'mark_read'
  | 'create_task'
  | 'update_task'
  | 'checkin_answer'
  | 'upload_file'
  | 'project_stage'
  | 'lock_baseline'
  | 'member_add'
  | 'member_update'
  | 'member_remove'
  // demo additions, see DECISIONS.md
  | 'create_dm'
  | 'create_project'
  // project settings
  | 'update_project'
  | 'create_channel'
  | 'update_channel'
  | 'delete_channel'
  | 'join_channel'
  | 'archive_project'
  | 'delete_project';

export interface OutboxItem {
  id: ID;
  kind: OutboxKind;
  lane: string;
  entityId: ID;
  payload: string;
  dependsOn: ID | null;
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  lastErrorCode: string | null;
  createdAt: number;
}

// ---- API payloads ----

export interface SyncResponse {
  serverTime: string;
  users: User[];
  projects: Project[];
  projectMembers: ProjectMember[];
  channels: Channel[];
  channelMembers: ChannelMember[];
  messages: Message[];
  tasks: Task[];
  taskHistory: TaskHistory[];
  checkins: Checkin[];
  activities: Activity[];
  removed: { projects: ID[]; channels: ID[]; tasks: ID[]; messages: ID[] };
  hasMore: boolean;
  cursor: number | null;
}

export interface DashboardResponse {
  generatedAt: string;
  stats: { activeProjects: number; delayed: number; dueThisWeek: number; blocked: number };
  byStage: { stage: Stage; count: number }[];
  delayedProjects: { id: ID; name: string; stage: Stage; daysBehind: number; pmId: ID | null }[];
  todayOnSites: {
    id: ID;
    projectName: string;
    userId: ID;
    text: string;
    at: string;
    attachments: Attachment[];
  }[];
}

export type ServerEvent =
  | { type: 'message.new' | 'message.updated' | 'message.deleted'; message: Message }
  | { type: 'task.updated' | 'task.created'; task: Task; history: TaskHistory[] }
  | { type: 'channel.updated'; channel: Channel }
  | { type: 'channel.member_added' | 'channel.member_removed'; channelId: ID; userId: ID }
  | { type: 'project.updated'; project: Project }
  | { type: 'checkin.new'; checkin: Checkin }
  | { type: 'activity.new'; activity: Activity };
