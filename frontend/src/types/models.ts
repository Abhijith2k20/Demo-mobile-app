export type ID = string; // UUIDv7

export type CompanyRole = 'owner' | 'admin' | 'member' | 'guest';
export type ProjectRole = 'manager' | 'member';
/** Job titles are the company's own words (its setup on the server, sent in /meta). */
export type JobTitle = string;

export interface User {
  id: ID;
  name: string;
  /** Work email and/or phone (E.164); at least one. */
  email: string | null;
  phone?: string | null;
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
  /** Link to the project in the PM app, when it gives one. */
  pmUrl: string | null;
  /** Set when the project is archived: everything in it becomes read-only. */
  archivedAt: string | null;
  updatedAt: string;
}

export interface ProjectMember {
  projectId: ID;
  userId: ID;
  role: ProjectRole;
  jobTitle: JobTitle;
  /** Where the membership comes from: the PM app, added in Siteline, or a guest. */
  source?: 'pm' | 'manual' | 'guest';
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
  | 'card'
  | 'issue_card'
  | 'daily_report'
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

/** A task the PM app asked about in this project lately (for "Related task" in Report issue). */
export interface RelatedTask {
  id: ID;
  name: string;
}

// ---- Cards from the PM app (docs/CARDS_API.md). The app draws them from their content and decides nothing. ----

export type Tone = 'info' | 'success' | 'warning' | 'danger';

export interface CardChoice {
  id: string;
  label: string;
  noteRequired?: boolean;
}

export interface CardButton extends CardChoice {
  choices?: CardChoice[];
}

export interface CardContent {
  title: string;
  subtitle?: string;
  badge?: { text: string; tone: Tone };
  fields?: { label: string; value: string }[];
  scale?: { id: string; label: string }[];
  /** Stops up to this one are shaded as already reached. */
  scaleReached?: string;
  buttons?: CardButton[];
  note?: { text?: boolean; voice?: boolean; photo?: boolean };
}

export interface CardAnswer {
  scale?: string;
  button?: string;
  choice?: string;
  note?: string;
  voiceUploadId?: ID;
  voiceSec?: number;
  photoUploadIds?: ID[];
  answeredAt?: string;
}

export interface Card {
  id: ID;
  extId: string;
  userId: ID;
  projectId: ID | null;
  projectName: string | null;
  content: CardContent;
  /** expired: an open card past its expiry (worked out by the server). */
  state: 'open' | 'answered' | 'closed' | 'expired';
  closedText: string | null;
  answer: CardAnswer | null;
  answeredAt: string | null;
  /** Whether the answer reached the PM app. */
  delivery: 'pending' | 'delivered' | 'refused' | 'failed' | null;
  deliveryError: string | null;
  askedAt: string;
  /** The answer is in the send queue on this phone. */
  sending?: boolean;
}

/** A card the PM app posted in a project channel (status updates, escalations). */
export interface ChannelCard {
  title: string;
  lines?: string[];
  tone?: Tone;
  /** Upload ids; the server adds signed links in `photoUrls`. */
  photos?: ID[];
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
  | 'notice';

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
export interface CompanyRef extends Company {
  /** Projects and people come from the company's PM app (no "New project" in Siteline). */
  pmLinked?: boolean;
}

/** A company the person can open, with their role there. */
export interface CompanyChoice extends Company {
  role: CompanyRole;
}

/** An invite waiting for the signed-in person. */
export interface PendingInvite {
  id: ID;
  companyId: ID;
  companyName: string;
  role: CompanyRole;
  invitedBy: string | null;
}

/** An invite the Owner or an Admin sent (Invites screen). */
export interface SentInvite {
  id: ID;
  identifier: string;
  name: string;
  role: CompanyRole;
  channelIds: ID[];
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
}

/** Development and staging builds: one sign-in per role in each seeded company. */
export interface DemoAccount {
  identifier: string;
  email: string | null;
  company: string;
  name: string;
  companyRole: CompanyRole;
  jobTitle: string | null;
}

export interface UserView extends User {
  /** Whether the viewer may deactivate this person. */
  canDeactivate?: boolean;
  /** Whether the viewer may change this person's company role. */
  canChangeRole?: boolean;
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
  /** Quick picks for Report issue. "Other" is added by the app. */
  problemTypes: { key: string; label: string; inCheckins: boolean }[];
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
  | { type: 'card.new' | 'card.updated'; card: Card }
  | { type: 'session.ended' }
  | { type: 'membership.removed' }
  | { type: 'activity.new'; activity: Activity }
  | { type: 'activity.read' }
  | { type: 'user.updated'; user: User };
