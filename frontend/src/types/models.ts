export type ID = string; // UUIDv7

export type CompanyRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'manager' | 'member';
/** Job titles are the company's own words (its setup on the server, sent in /meta). */
export type JobTitle = string;

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
  /** The project in the company's PM app; null for a project made in Siteline. */
  pmProjectId: ID | null;
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

/** A task as the PM app has it. Siteline only reads tasks; the bot sends answers back. */
export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export interface PmTask {
  id: ID;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  status: TaskStatus;
  percent: number;
  /** Not done and its finish date has passed (worked out by the server). */
  isOverdue: boolean;
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
  /** The task in the PM app. */
  taskId: ID;
  taskName: string;
  projectId: ID | null;
  projectName: string | null;
  userId: ID;
  askedAt: string;
  answer: null | CheckinAnswer;
  /** The task as the PM app has it now; null once it was removed there. */
  task: PmTask | null;
  /** Whether the answer reached the PM app: saved, refused (reason in `pmError`), or nothing to save. */
  pmWrite: 'saved' | 'refused' | null;
  pmError: string | null;
  /** Nothing left to answer: the task was finished or removed in the PM app. */
  closed: boolean;
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
  /** Extra lines under the text. */
  lines: string[];
  createdAt: string;
}

// ---- What the API returns: records plus fields the server works out for the viewer ----

/** What the server says the viewer may do in a project (the app's hook adds helpers: `useProjectAccess`). */
export interface ProjectAccessInfo {
  role: ProjectRole | null;
  jobTitle: JobTitle | null;
  /** Actions the viewer may take in this project right now (e.g. 'channel.manage', 'project.archive'). */
  permissions: string[];
}
export interface ProjectView extends Project {
  /** Linked to a project in the PM app. */
  linked: boolean;
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
