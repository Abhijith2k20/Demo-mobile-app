export type ID = string; // UUIDv7

export type CompanyRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'manager' | 'member';
/** Job titles and stages are the company's own words (its setup on the server, sent in /meta). */
export type JobTitle = string;
/** A stage key from the company's setup. */
export type Stage = string;

export interface User {
  id: ID;
  name: string;
  email: string;
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

/** 'pending' and 'failed' only exist on the phone, for messages still in the send queue. */
export type MessageStatus = 'sent' | 'pending' | 'failed';

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
  /** The answer is in the send queue on this phone. */
  sending?: boolean;
}

// ---- Additions beyond the spec's model list (see DECISIONS.md) ----

export type PhotoTone = 'sand' | 'stone' | 'linen' | 'sage';

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

// ---- What the API returns: records plus fields the server works out for the viewer ----

/** What the server says the viewer may do in a project (the app's hook adds helpers: `useProjectAccess`). */
export interface ProjectAccessInfo {
  role: ProjectRole | null;
  jobTitle: JobTitle | null;
  /** Actions the viewer may take in this project right now (e.g. 'task.edit_any', 'project.archive'). */
  permissions: string[];
}
export interface ProjectView extends Project {
  /** Days behind (positive) or ahead (negative) of the locked baseline; 0 without one. */
  delayDays: number;
  /** The stage after this one in the company's setup; null at the last stage. */
  nextStage: Stage | null;
  /** Finished tasks out of all of them. */
  progress: { done: number; total: number; percent: number };
  members: ProjectMember[];
  access: ProjectAccessInfo;
}

export interface MessageView extends Message {
  replyCount: number;
  lastReplyAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
}

export interface ChannelView extends Channel {
  /** People listed as members (for project channels: project members only). */
  memberIds: ID[];
  /** The other person in a DM. */
  peerId: ID | null;
  joined: boolean;
  unreadCount: number;
  lastReadMessageId: ID | null;
  /** Server time of the last read message: the "new" divider starts after it. */
  lastReadAt: string | null;
  lastMessage: MessageView | null;
  canPost: boolean;
  /** Only in "Browse channels". */
  memberCount?: number;
}

export interface TaskView extends Task {
  /** Positive = finishing later than baseline; null without a baseline. */
  varianceDays: number | null;
  /** Not done and its finish date has passed. */
  isLate: boolean;
  /** Not done and planned to finish later than its baseline. */
  isDelayed: boolean;
}

/** The schedule as the server filtered it. Everything but `tasks` covers the whole project. */
export interface TaskList {
  /** Matching tasks, in phase order. */
  tasks: TaskView[];
  total: number;
  /** Phases the project uses, in order, with whole-phase progress. */
  phases: { name: string; done: number; total: number }[];
  /** Phases a new task can go in. */
  phaseChoices: string[];
  /** Where work is happening now (quick add targets it). */
  currentPhase: string | null;
  /** Date span the timeline bars are drawn against. */
  window: { from: string; to: string };
}

/** What a new task form starts with. */
export interface TaskDefaults {
  phase: string;
  plannedStart: string;
  plannedFinish: string;
  /** Phases to offer: the project's own, then the company's. */
  phaseChoices: string[];
}

export interface Company {
  id: ID;
  name: string;
}

/** Demo build: one sign-in per role. */
export interface DemoAccount {
  email: string;
  name: string;
  companyRole: CompanyRole;
  /** Already in the reader's language. */
  jobTitle: string | null;
}

export interface UserView extends User {
  /** Whether the viewer may deactivate this person. */
  canDeactivate?: boolean;
  /** False for the Owner and Admins: they see every project already, so they're never added to one. */
  joinsProjects?: boolean;
}

export interface ActivityView extends Activity {
  read: boolean;
}

export interface Meta {
  /** In order, with labels in the reader's language. */
  stages: { key: Stage; label: string }[];
  phases: string[];
  jobTitles: { name: JobTitle; label: string; managersOnly: boolean }[];
  /** Job title a new project member starts with. */
  defaultJobTitle: JobTitle;
  /** Quick picks for problems; `inCheckins: false` ones aren't offered in bot check-ins. "Other" is added by the app. */
  problemTypes: { key: string; label: string; inCheckins: boolean }[];
  percentSteps: number[];
  editWindowMs: number;
  deleteWindowMs: number;
  /** role → job title → channel names a new member joins by default */
  defaultChannels: Record<ProjectRole, Record<JobTitle, string[]>>;
  /** Project roles that are always in every channel of their project. */
  rolesInEveryChannel: ProjectRole[];
}

export type ServerEvent =
  | { type: 'message.new' | 'message.updated' | 'message.deleted'; message: Message }
  | { type: 'task.updated' | 'task.created'; task: Task; history: TaskHistory[] }
  | { type: 'channel.updated'; channel: Channel }
  | { type: 'channel.deleted'; channelId: ID }
  | { type: 'channel.member_added' | 'channel.member_removed'; channelId: ID; userId: ID }
  | { type: 'channel.read'; channelId: ID; userId: ID }
  | { type: 'project.updated'; project: Project }
  | { type: 'project.deleted'; projectId: ID }
  | { type: 'checkin.new'; checkin: Checkin }
  | { type: 'activity.new'; activity: Activity }
  | { type: 'activity.read' }
  | { type: 'user.updated'; user: User };
