export type ID = string; // UUIDv7

export type CompanyRole = 'owner' | 'admin' | 'member' | 'guest';

export interface User {
  id: ID;
  name: string;
  /** Work email: how the person signs in and is invited (null once the account is deleted). */
  email: string | null;
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
  /** Set when the project is archived: everything in it becomes read-only. */
  archivedAt: string | null;
  updatedAt: string;
}

/** Someone on a project: they can see it and browse its channels. The Owner and Admins see every project. */
export interface ProjectMember {
  projectId: ID;
  userId: ID;
}

type ChannelKind = 'project' | 'company' | 'dm' | 'bot';
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

export type MessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'file'
  | 'card'
  | 'system';

/** 'pending' and 'failed' only exist on the phone, for messages still in the send queue. */
type MessageStatus = 'sent' | 'pending' | 'failed';

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

// ---- Cards from the PM app (docs/CARDS_API.md). The app draws them from their content and decides nothing. ----

export type Tone = 'info' | 'success' | 'warning' | 'danger';

interface CardChoice {
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
  seenAt: string | null;
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
  | 'notice';

export interface Activity {
  id: ID;
  userId: ID;
  kind: ActivityKind;
  actorId: ID;
  projectId: ID | null;
  channelId: ID | null;
  messageId: ID | null;
  text: string;
  /** Extra lines under the text. */
  lines: string[];
  createdAt: string;
}

// ---- What the API returns: records plus fields the server works out for the viewer ----

/** What the server says the viewer may do in a project (the app's hook adds helpers: `useProjectAccess`). */
interface ProjectAccessInfo {
  /** Actions the viewer may take in this project right now (e.g. 'channel.manage', 'project.archive'). */
  permissions: string[];
}
export interface ProjectView extends Project {
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
  /** This person muted it: no pushes except @mentions, and it doesn't count in the tab badges. */
  muted: boolean;
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
export type CompanyRef = Company;

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

/** Development and staging builds: everyone in each seeded company. */
export interface DemoAccount {
  identifier: string;
  email: string | null;
  company: string;
  name: string;
  companyRole: CompanyRole;
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
