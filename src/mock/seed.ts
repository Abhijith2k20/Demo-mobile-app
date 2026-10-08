// All demo data (§11). Dates are relative to "now" so the demo always looks current.
import { addDays, format, startOfDay } from 'date-fns';
import { defaultChannelNames } from '@/shared/permissions';
import { avatarTone } from '@/theme/colors';
import type {
  Attachment,
  Channel,
  CompanyRole,
  ID,
  JobTitle,
  Message,
  MessageType,
  PhotoTone,
  Project,
  ProjectRole,
  Stage,
  Task,
  TaskStatus,
} from '@/types/models';
import { registerSeed, type MockStore, type StoredCheckin } from './db';

let seq = 0;
/** UUIDv7-shaped id for a given time, ordered by time then by creation order. */
export function uuidAt(ms: number): ID {
  const t = Math.floor(ms).toString(16).padStart(12, '0');
  const s = (seq++).toString(16).padStart(11, '0');
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${s.slice(0, 3)}-8${s.slice(3, 6)}-0000000${s.slice(6, 11)}`;
}

type UserKey =
  | 'arjun'
  | 'meera'
  | 'amit'
  | 'kavya'
  | 'rohan'
  | 'suresh'
  | 'ravi'
  | 'manju'
  | 'imran'
  | 'lakshmi'
  | 'prakash'
  | 'bot';

export const DEMO_PHONES: { phone: string; name: string; subtitle: string }[] = [
  { phone: '9845000001', name: 'Arjun Rao', subtitle: 'Owner · CEO' },
  { phone: '9845000002', name: 'Meera Iyer', subtitle: 'Admin · Operations' },
  { phone: '9845000003', name: 'Amit Kulkarni', subtitle: 'Project Manager' },
  { phone: '9845000004', name: 'Kavya Shetty', subtitle: 'Designer' },
  { phone: '9845000005', name: 'Rohan Desai', subtitle: 'QS' },
  { phone: '9845000006', name: 'Suresh Gowda', subtitle: 'Supervisor' },
  { phone: '9845000007', name: 'Ravi Kumar', subtitle: 'Worker' },
];

function build(): MockStore {
  seq = 0;
  const now = Date.now();
  const today = startOfDay(now).getTime();
  const DAY = 86400000;
  const epoch = now - 60 * DAY;
  const iso = (ms: number) => new Date(ms).toISOString();
  const day = (offset: number) => format(addDays(today, offset), 'yyyy-MM-dd');
  /** A time `d` days ago at hh:mm; never in the future. */
  const at = (d: number, hh: number, mm: number) => Math.min(today - d * DAY + hh * 3600000 + mm * 60000, now - 60000);
  const ago = (mins: number) => now - mins * 60000;

  const companyId = uuidAt(epoch);
  const s: MockStore = {
    companyId,
    botId: '',
    users: new Map(),
    projects: new Map(),
    projectMembers: [],
    channels: new Map(),
    channelMembers: [],
    messages: new Map(),
    tasks: new Map(),
    taskHistory: [],
    checkins: new Map(),
    activities: [],
    uploads: new Map(),
    removals: [],
    tokens: new Map(),
    otpAttempts: new Map(),
  };

  // ---- Users ----
  const U = {} as Record<UserKey, ID>;
  const addUser = (key: UserKey, name: string, phone: string, companyRole: CompanyRole, online = false) => {
    const id = uuidAt(epoch);
    U[key] = id;
    s.users.set(id, {
      id,
      name,
      phone,
      companyRole,
      avatarColor: avatarTone(id),
      isActive: true,
      updatedAt: iso(epoch),
      online,
    });
  };
  addUser('arjun', 'Arjun Rao', '9845000001', 'owner', true);
  addUser('meera', 'Meera Iyer', '9845000002', 'admin', true);
  addUser('amit', 'Amit Kulkarni', '9845000003', 'member', true);
  addUser('kavya', 'Kavya Shetty', '9845000004', 'member', true);
  addUser('rohan', 'Rohan Desai', '9845000005', 'member');
  addUser('suresh', 'Suresh Gowda', '9845000006', 'member', true);
  addUser('ravi', 'Ravi Kumar', '9845000007', 'member');
  addUser('manju', 'Manjunath', '9845000008', 'member');
  addUser('imran', 'Imran Pasha', '9845000009', 'member', true);
  addUser('lakshmi', 'Lakshmi Devi', '9845000010', 'member');
  addUser('prakash', 'Prakash Naik', '9845000011', 'member');
  addUser('bot', 'Siteline Bot', '0000000000', 'member', true);
  s.botId = U.bot;
  const adminKeys: UserKey[] = ['arjun', 'meera'];
  const humanKeys = (Object.keys(U) as UserKey[]).filter((k) => k !== 'bot');

  // ---- Channels ----
  const addChannel = (
    name: string,
    kind: Channel['kind'],
    projectId: ID | null,
    members: UserKey[],
    opts: Partial<Channel> = {},
  ): ID => {
    const id = uuidAt(epoch);
    s.channels.set(id, {
      id,
      companyId,
      projectId,
      name,
      kind,
      isPrivate: false,
      postingPolicy: 'everyone',
      updatedAt: iso(epoch),
      ...opts,
    });
    for (const m of members) {
      s.channelMembers.push({ channelId: id, userId: U[m], lastReadMessageId: null, joinedAt: iso(epoch) });
    }
    return id;
  };

  // ---- Projects ----
  type MemberSpec = [UserKey, ProjectRole, JobTitle];
  const addProject = (
    name: string,
    client: string,
    address: string,
    stage: Stage,
    startOffset: number,
    members: MemberSpec[],
  ) => {
    const id = uuidAt(epoch);
    const project: Project = {
      id,
      companyId,
      name,
      client,
      address,
      stage,
      startDate: day(startOffset),
      plannedFinish: day(startOffset),
      baselineFinish: null,
      baselineLocked: false,
      updatedAt: iso(epoch),
    };
    s.projects.set(id, project);
    for (const [k, role, jobTitle] of members) {
      s.projectMembers.push({ projectId: id, userId: U[k], role, jobTitle, joinedAt: iso(epoch) });
    }
    const ch = {} as Record<'general' | 'design' | 'site-work' | 'qs', ID>;
    for (const cname of ['general', 'design', 'site-work', 'qs'] as const) {
      const joined = members.filter(([, role, jt]) => defaultChannelNames(role, jt).includes(cname)).map(([k]) => k);
      ch[cname] = addChannel(cname, 'project', id, [...new Set([...joined, ...adminKeys])], {
        isPrivate: cname === 'qs',
      });
    }
    return { id, project, ch };
  };

  const sharma = addProject(
    'Sharma Residence – Whitefield',
    'Mr & Mrs Sharma',
    'Prestige Lakeside Habitat, Whitefield, Bengaluru',
    'execution',
    -45,
    [
      ['amit', 'manager', 'Project Manager'],
      ['kavya', 'member', 'Designer'],
      ['rohan', 'member', 'QS'],
      ['suresh', 'manager', 'Supervisor'],
      ['ravi', 'member', 'Worker'],
      ['manju', 'member', 'Worker'],
      ['imran', 'member', 'Worker'],
    ],
  );
  const mehta = addProject(
    'Mehta Villa – Koramangala',
    'Mr Dev Mehta',
    '4th Block, Koramangala, Bengaluru',
    'design',
    -12,
    [
      ['kavya', 'manager', 'Project Manager'],
      ['rohan', 'member', 'QS'],
    ],
  );
  const cafe = addProject(
    'Café Brew Fit-out – Indiranagar',
    'Brew Hospitality LLP',
    '12th Main, Indiranagar, Bengaluru',
    'finishing',
    -50,
    [
      ['amit', 'manager', 'Project Manager'],
      ['suresh', 'member', 'Supervisor'],
      ['imran', 'member', 'Worker'],
      ['lakshmi', 'member', 'Worker'],
      ['prakash', 'member', 'Worker'],
    ],
  );

  const announcements = addChannel('announcements', 'company', null, humanKeys, { postingPolicy: 'admins' });
  const companyGeneral = addChannel('general', 'company', null, humanKeys);
  const dmAmitRavi = addChannel('', 'dm', null, ['amit', 'ravi'], { isPrivate: true });
  const dmAmitSuresh = addChannel('', 'dm', null, ['amit', 'suresh'], { isPrivate: true });
  const dmArjunAmit = addChannel('', 'dm', null, ['arjun', 'amit'], { isPrivate: true });
  const botDm = {} as Record<UserKey, ID>;
  for (const k of humanKeys) botDm[k] = addChannel('Siteline Bot', 'bot', null, [k], { isPrivate: true });

  // ---- Tasks ----
  type TaskSpec = [
    phase: string,
    name: string,
    start: number,
    finish: number,
    status: TaskStatus,
    percent: number,
    owner: UserKey | null,
    slip?: number,
  ];
  const T: Record<string, ID> = {};
  const addTasks = (
    p: { id: ID; project: Project; ch: Record<string, ID> },
    specs: TaskSpec[],
    baselineLocked: boolean,
  ) => {
    let maxPlanned = p.project.startDate;
    let maxBaseline = '';
    for (const [phase, name, start, finish, status, percent, owner, slip = 0] of specs) {
      const id = uuidAt(epoch);
      T[name] = id;
      const done = status === 'done';
      const task: Task = {
        id,
        projectId: p.id,
        phase,
        name,
        description: null,
        ownerId: owner ? U[owner] : null,
        plannedStart: day(start),
        plannedFinish: day(finish),
        baselineStart: baselineLocked ? day(start - slip) : null,
        baselineFinish: baselineLocked ? day(finish - slip) : null,
        actualStart: status === 'not_started' ? null : day(start),
        actualFinish: done ? day(finish) : null,
        status,
        percent,
        channelId: phase === 'Design' ? p.ch.design : p.ch['site-work'],
        updatedAt: iso(epoch),
        deletedAt: null,
      };
      s.tasks.set(id, task);
      if (task.plannedFinish > maxPlanned) maxPlanned = task.plannedFinish;
      if (task.baselineFinish && task.baselineFinish > maxBaseline) maxBaseline = task.baselineFinish;
    }
    p.project.plannedFinish = maxPlanned;
    p.project.baselineLocked = baselineLocked;
    p.project.baselineFinish = baselineLocked ? maxBaseline : null;
  };

  addTasks(
    sharma,
    [
      ['Civil', 'Demolition & debris clearing', -44, -41, 'done', 100, 'suresh'],
      ['Civil', 'Wall chasing for conduits', -41, -38, 'done', 100, 'manju'],
      ['Civil', 'Masonry partition – kitchen', -38, -34, 'done', 100, 'manju'],
      ['Civil', 'Floor levelling', -34, -31, 'done', 100, 'suresh'],
      ['Electrical', 'Conduit laying', -31, -28, 'done', 100, 'suresh'],
      ['Electrical', 'Wiring – bedrooms', -28, -25, 'done', 100, 'suresh'],
      ['Electrical', 'Wiring – living & kitchen', -25, -22, 'done', 100, 'suresh'],
      ['Electrical', 'DB & switch boxes', -22, -20, 'done', 100, 'suresh'],
      ['Plumbing', 'Kitchen plumbing lines', -30, -27, 'done', 100, 'manju'],
      ['Plumbing', 'Bathroom plumbing – master', -27, -24, 'done', 100, 'manju'],
      ['Plumbing', 'Pressure test', -24, -23, 'done', 100, 'suresh'],
      ['False ceiling', 'Framing grid – living room', -10, -7, 'done', 100, 'ravi'],
      ['False ceiling', 'False ceiling – living room', -7, 2, 'in_progress', 50, 'ravi', 4],
      ['False ceiling', 'False ceiling – master bedroom', -5, 3, 'blocked', 10, 'ravi', 4],
      ['False ceiling', 'False ceiling – kids bedroom', 3, 6, 'not_started', 0, 'ravi', 4],
      ['False ceiling', 'Cove lighting channels', 5, 7, 'not_started', 0, 'manju', 4],
      ['Carpentry', 'Kitchen carcass', -3, 6, 'in_progress', 25, 'imran', 4],
      ['Carpentry', 'Wardrobe – master bedroom', 1, 9, 'not_started', 0, 'imran', 4],
      ['Carpentry', 'Wardrobe – kids bedroom', 6, 12, 'not_started', 0, 'imran', 4],
      ['Carpentry', 'TV unit – living room', 9, 14, 'not_started', 0, 'imran', 4],
      ['Carpentry', 'Shoe rack & foyer panel', 12, 15, 'not_started', 0, null, 4],
      ['Carpentry', 'Study table', 14, 17, 'not_started', 0, null, 4],
      ['Painting', 'Putty & primer', 8, 12, 'not_started', 0, null, 4],
      ['Painting', 'First coat', 12, 15, 'not_started', 0, null, 4],
      ['Painting', 'Texture wall – living room', 15, 17, 'not_started', 0, null, 4],
      ['Painting', 'Final coat', 18, 21, 'not_started', 0, null, 4],
      ['Finishing', 'Hardware & handles', 17, 19, 'not_started', 0, 'imran', 4],
      ['Finishing', 'Light fixtures', 19, 21, 'not_started', 0, 'suresh', 4],
      ['Finishing', 'Soft furnishings', 21, 23, 'not_started', 0, 'kavya', 4],
      ['Finishing', 'Deep cleaning', 23, 24, 'not_started', 0, 'suresh', 4],
      ['Handover', 'Snag list walkthrough', 24, 25, 'not_started', 0, 'amit', 4],
      ['Handover', 'Client handover', 26, 26, 'not_started', 0, 'amit', 4],
    ],
    true,
  );
  addTasks(
    mehta,
    [
      ['Design', 'Site measurement', -12, -11, 'done', 100, 'kavya'],
      ['Design', 'Client brief & moodboard', -11, -8, 'done', 100, 'kavya'],
      ['Design', 'Concept layout options', -8, -5, 'done', 100, 'kavya'],
      ['Design', 'Concept presentation', -4, -3, 'done', 100, 'kavya'],
      ['Design', '3D renders – living & dining', -2, 3, 'in_progress', 50, 'kavya'],
      ['Design', '3D renders – bedrooms', 3, 7, 'not_started', 0, 'kavya'],
      ['Design', 'Material board', -1, 5, 'in_progress', 25, 'kavya'],
      ['Design', 'Lighting plan', 5, 8, 'not_started', 0, 'kavya'],
      ['Design', 'Kitchen detailed drawings', 7, 11, 'not_started', 0, 'kavya'],
      ['Design', 'BOQ & estimate', 8, 12, 'not_started', 0, 'rohan'],
      ['Design', 'Client approval – design', 12, 14, 'not_started', 0, 'kavya'],
      ['Design', 'Sign-off & advance', 14, 15, 'not_started', 0, 'rohan'],
    ],
    false,
  );
  addTasks(
    cafe,
    [
      ['Civil', 'Site clearing & marking', -50, -47, 'done', 100, 'suresh'],
      ['Civil', 'Counter masonry base', -47, -42, 'done', 100, 'prakash'],
      ['Electrical', 'Conduits & wiring', -42, -36, 'done', 100, 'suresh'],
      ['Electrical', 'Kitchen power points', -36, -33, 'done', 100, 'suresh'],
      ['Plumbing', 'Bar sink & drain lines', -40, -36, 'done', 100, 'prakash'],
      ['Plumbing', 'Washroom plumbing', -36, -32, 'done', 100, 'prakash'],
      ['False ceiling', 'Exposed ceiling paint', -32, -29, 'done', 100, 'lakshmi'],
      ['False ceiling', 'Acoustic baffles', -29, -25, 'done', 100, 'imran'],
      ['Carpentry', 'Bar counter cladding', -25, -18, 'done', 100, 'imran'],
      ['Carpentry', 'Banquette seating', -18, -12, 'done', 100, 'imran'],
      ['Carpentry', 'Display shelves', -12, -8, 'done', 100, 'imran'],
      ['Painting', 'Wall putty & primer', -14, -10, 'done', 100, 'lakshmi'],
      ['Painting', 'Feature wall mural base', -10, -7, 'done', 100, 'lakshmi'],
      ['Painting', 'Final coat – seating area', -6, -3, 'done', 100, 'lakshmi', -1],
      ['Finishing', 'Counter stone & polish', -6, -2, 'done', 100, 'prakash', -1],
      ['Finishing', 'Pendant lights', -1, 2, 'in_progress', 50, 'suresh', -1],
      ['Finishing', 'Signage & branding', 1, 4, 'not_started', 0, 'imran', -1],
      ['Handover', 'Snag list & handover', 4, 6, 'not_started', 0, 'amit', -1],
    ],
    true,
  );

  // ---- Messages ----
  const img = (tone: PhotoTone, caption: string): Attachment => ({
    id: uuidAt(epoch),
    kind: 'image',
    uri: null,
    uploadId: null,
    caption,
    tone,
  });
  interface Extra {
    type?: MessageType;
    data?: Record<string, unknown>;
    parent?: ID;
    reactions?: Record<string, UserKey[]>;
    deleted?: boolean;
  }
  const say = (channelId: ID, ms: number, sender: UserKey, body: string | null, x: Extra = {}): ID => {
    const id = uuidAt(ms);
    const reactions: Record<string, ID[]> = {};
    for (const [emoji, keys] of Object.entries(x.reactions ?? {})) reactions[emoji] = keys.map((k) => U[k]);
    const m: Message = {
      id,
      channelId,
      senderId: U[sender],
      type: x.type ?? 'text',
      body: x.deleted ? null : body,
      data: x.deleted ? null : (x.data ?? null),
      threadParentId: x.parent ?? null,
      reactions,
      status: 'sent',
      createdAt: iso(ms),
      updatedAt: iso(ms),
      deletedAt: x.deleted ? iso(ms + 120000) : null,
    };
    s.messages.set(id, m);
    return id;
  };
  const photos = (...a: Attachment[]): Extra => ({ type: 'image', data: { attachments: a } });
  const file = (name: string, sizeKb: number): Extra => ({ type: 'file', data: { name, sizeKb } });
  const status = (user: UserKey, taskName: string, answer: Record<string, unknown>, hasPhoto = false): Extra => ({
    type: 'status_card',
    data: { kind: 'checkin', userId: U[user], taskId: T[taskName], taskName, answer, hasPhoto },
  });

  // Sharma — #site-work
  const sw = sharma.ch['site-work'];
  say(sw, at(9, 9, 10), 'suresh', 'Good morning team. Electrical and plumbing are closed out. False ceiling starts today in the living room.');
  say(sw, at(9, 9, 25), 'amit', 'Thanks Suresh. Ravi, Manjunath — please start with the framing grid. Drawings are in #design.');
  say(sw, at(9, 9, 40), 'ravi', 'Ok sir. Starting grid marking now.');
  say(sw, at(9, 13, 5), 'ravi', 'Level marking done', photos(img('concrete', 'Ceiling level marking')));
  say(sw, at(9, 17, 45), 'suresh', 'Site closed. 5 workers today. Grid marking complete in living room.');
  say(sw, at(8, 9, 15), 'manju', 'GI channels unloaded. 60 lengths.');
  say(sw, at(8, 11, 30), 'suresh', 'Plywood delivered — 18mm BWP, 40 sheets', photos(img('plywood', 'Plywood stack – 40 sheets')));
  say(sw, at(8, 11, 42), 'amit', 'Good. Keep it off the floor please, on battens.', { reactions: { '👍': ['suresh', 'ravi'] } });
  say(sw, at(8, 16, 20), 'ravi', 'Framing grid 60% done in living room');
  say(
    sw,
    at(7, 10, 0),
    'suresh',
    'False ceiling grid done in living room, gypsum boards tomorrow',
    photos(img('concrete', 'Living room grid'), img('tile', 'Grid – window side')),
  );
  say(sw, at(7, 10, 12), 'amit', 'Nice work 👏', { reactions: { '🙏': ['ravi'] } });
  say(sw, at(7, 15, 30), 'imran', 'Carpentry team will reach site Thursday. Need the kitchen wall cleared.');
  say(sw, at(7, 15, 44), 'suresh', 'Will clear by Wednesday evening.');
  const thread = say(sw, at(6, 9, 5), 'suresh', 'Gypsum boards for master bedroom not delivered. Vendor says the truck is stuck at Hosur.');
  say(sw, at(6, 9, 12), 'amit', 'How many boards short?', { parent: thread });
  say(sw, at(6, 9, 15), 'suresh', '24 boards. Living room stock is enough for now.', { parent: thread });
  say(sw, at(6, 9, 40), 'amit', 'Called the vendor — promised tomorrow before noon.', { parent: thread });
  say(sw, at(6, 9, 48), 'ravi', 'Ok sir, we will continue living room till then.', { parent: thread });
  say(sw, at(6, 9, 30), 'suresh', null, {
    type: 'issue_card',
    data: {
      what: 'Material not arrived',
      note: 'Gypsum boards for master bedroom, 24 nos.',
      urgency: 'urgent',
      taskId: T['False ceiling – master bedroom'],
      taskName: 'False ceiling – master bedroom',
      attachments: [img('concrete', 'Master bedroom – empty bay')],
      mentions: [U.amit],
    },
  });
  say(sw, at(6, 18, 4), 'bot', null, status('ravi', 'False ceiling – living room', { kind: 'progress', percent: 25 }));
  say(sw, at(6, 18, 20), 'suresh', null, {
    type: 'daily_report',
    data: {
      workDone: 'Living room boarding started, 8 boards fixed. Kitchen wall cleared for carpentry.',
      workers: 6,
      problems: 'Master bedroom boards not delivered.',
      tomorrow: 'Continue living room boarding. Receive gypsum boards.',
      attachments: [img('tile', 'Boarding – living room'), img('concrete', 'Kitchen wall cleared')],
    },
  });
  say(sw, at(5, 9, 20), 'ravi', null, { type: 'voice', data: { durationSec: 14 } });
  say(sw, at(5, 11, 0), 'amit', null, { type: 'task_card', data: { taskId: T['Kitchen carcass'] } });
  say(
    sw,
    at(5, 14, 15),
    'suresh',
    'Living room boarding progress',
    photos(img('tile', 'Boarding – centre'), img('concrete', 'Boarding – cove edge'), img('sage', 'Window side')),
  );
  say(sw, at(4, 9, 10), 'amit', 'Client visit on Saturday 11 am. Please keep the living room clean and the sample laminate ready.');
  say(sw, at(4, 9, 18), 'suresh', 'Noted.');
  say(sw, at(4, 16, 40), 'manju', 'Kitchen wall cleared for carpentry.');
  say(sw, at(4, 16, 41), 'manju', 'wrong photo', { deleted: true });
  say(sw, at(3, 10, 5), 'imran', 'Carcass cutting started. 18mm BWP for base units.', photos(img('plywood', 'Carcass panels cut')));
  say(sw, at(3, 10, 30), 'amit', 'Imran, please check drawing rev C — the TV unit is 6 inches wider now.', { data: { edited: true } });
  say(sw, at(3, 10, 36), 'imran', 'Seen. Will follow rev C.');
  say(sw, at(3, 18, 2), 'bot', null, status('ravi', 'False ceiling – living room', { kind: 'progress', percent: 50 }, true));
  say(sw, at(2, 9, 30), 'suresh', 'Electrician coming at 3 pm for cove light points. Ravi, keep the channel open on the window side.');
  say(sw, at(2, 9, 41), 'ravi', 'Ok sir');
  say(sw, at(2, 15, 10), 'amit', 'Latest false ceiling layout for site.', file('Sharma_FC_layout_revC.pdf', 842));
  say(sw, at(2, 18, 2), 'suresh', 'Site closed for the day. 6 workers today.');
  say(sw, at(1, 9, 12), 'suresh', 'Boards for master bedroom still not here. Following up.');
  say(sw, at(1, 11, 47), 'amit', '@Suresh vendor confirmed dispatch at 2 pm today.', { data: { mentions: [U.suresh] } });
  say(sw, at(1, 16, 30), 'imran', null, photos(img('plywood', 'Base units fixed – kitchen')));
  say(sw, at(1, 18, 5), 'suresh', 'Kitchen base carcass 25% done. Uppers start tomorrow.');
  say(sw, ago(190), 'suresh', 'Good morning. 7 workers on site today.');
  say(sw, ago(150), 'amit', '@Ravi please finish the living room boarding today, painter wants to start putty on Monday.', {
    data: { mentions: [U.ravi] },
  });
  say(sw, ago(95), 'manju', null, photos(img('concrete', 'Master bedroom – waiting for boards')));
  say(sw, ago(40), 'suresh', 'Boards arrived just now. 24 nos. Unloading.');
  say(sw, ago(22), 'amit', 'Finally. Thanks for chasing, Suresh.');

  // Sharma — #design
  const ds = sharma.ch.design;
  say(ds, at(9, 10, 0), 'kavya', 'Sharing the final false ceiling layout for living + dining.');
  say(ds, at(9, 10, 2), 'kavya', null, photos(img('tile', 'Living room ceiling'), img('sage', 'Dining cove detail')));
  say(ds, at(9, 10, 30), 'amit', 'Looks good. Cove depth 4 inches confirmed?');
  say(ds, at(9, 10, 34), 'kavya', 'Yes, 4 inch cove with a warm white strip.');
  say(ds, at(8, 12, 0), 'kavya', 'Laminate shortlist for wardrobes — 3 options. Client to pick by Friday.');
  say(ds, at(8, 12, 1), 'kavya', null, photos(img('plywood', 'Option 1 – walnut'), img('tile', 'Option 2 – ash'), img('sage', 'Option 3 – olive')));
  say(ds, at(8, 14, 20), 'amit', 'Option 2 matches the flooring best in my view.');
  say(ds, at(8, 14, 50), 'arjun', 'Agree with option 2. Keep the handles matte black.', { reactions: { '👍': ['kavya', 'amit'] } });
  say(ds, at(7, 11, 15), 'kavya', 'Client wants the TV unit 6 inches wider, updated drawing attached', file('TV_unit_revC.pdf', 516));
  say(ds, at(7, 11, 40), 'amit', 'Does that affect the cove light switch position?');
  say(ds, at(7, 11, 52), 'kavya', 'No, the switch stays. Only the side panel shifts.');
  say(ds, at(6, 10, 10), 'kavya', 'Kitchen elevation updated with the taller unit for the oven.');
  say(ds, at(6, 10, 11), 'kavya', null, photos(img('tile', 'Kitchen elevation B')));
  say(ds, at(6, 15, 0), 'amit', 'Imran needs the hinge schedule. Can you share today?');
  say(ds, at(6, 16, 22), 'kavya', 'Here it is.', file('Hinge_schedule.pdf', 228));
  say(ds, at(5, 9, 45), 'kavya', 'Paint shades for approval: living — Morning Fog, bedrooms — Warm Linen.');
  say(ds, at(5, 9, 46), 'kavya', null, photos(img('sage', 'Shade card')));
  say(ds, at(5, 13, 10), 'meera', 'Client approved Morning Fog over call. Please note it.');
  say(ds, at(5, 13, 12), 'kavya', 'Noted, thank you Meera.');
  say(ds, at(4, 11, 0), 'kavya', 'Texture wall sample is ready at the studio.', photos(img('concrete', 'Texture sample')));
  say(ds, at(4, 11, 30), 'amit', 'Bring it on Saturday for the client visit.', { reactions: { '👍': ['kavya'] } });
  say(ds, at(3, 10, 0), 'kavya', 'TV unit rev C issued for site.');
  say(ds, at(3, 10, 2), 'amit', 'Sent to Imran.');
  say(ds, at(2, 12, 20), 'kavya', 'Study table: client wants a cable tray added. Small change, no cost impact.');
  say(ds, at(2, 12, 45), 'amit', 'Ok. Please mark it in the drawing.');
  say(ds, at(1, 15, 0), 'kavya', 'Wardrobe internals final — master bedroom.', photos(img('plywood', 'Wardrobe internals')));
  say(ds, at(1, 15, 25), 'amit', 'Approved from my side.');
  say(ds, ago(130), 'kavya', 'Working on the foyer shoe rack detail today.');
  say(ds, ago(60), 'kavya', 'Foyer detail — two options.', photos(img('plywood', 'Foyer option A'), img('tile', 'Foyer option B')));
  say(ds, ago(35), 'amit', 'Option A. Simpler to build.');

  // Sharma — #qs (private)
  const qs = sharma.ch.qs;
  say(qs, at(8, 10, 5), 'rohan', 'Rate for Italian marble came in at ₹420/sq ft, ₹35 above budget');
  say(qs, at(8, 10, 20), 'amit', 'Can we get a second quote?');
  say(qs, at(8, 10, 24), 'rohan', 'Asked two more vendors. Will have numbers tomorrow.');
  say(qs, at(7, 12, 30), 'rohan', 'Second quote ₹398/sq ft from Lakshmi Marbles. Delivery in 6 days.');
  say(qs, at(7, 12, 55), 'amit', 'Go with ₹398. Please raise the PO.');
  say(qs, at(5, 11, 10), 'rohan', 'Plywood bill passed: ₹1,84,000 for 40 sheets 18mm BWP.');
  say(qs, at(5, 16, 0), 'arjun', "What's our running variance on this project?");
  say(qs, at(5, 16, 18), 'rohan', '₹62,000 over on materials so far, mostly marble and hardware.');
  say(qs, at(3, 14, 40), 'rohan', 'Hardware quote (Hettich) is ₹96,500. Ebco alternative ₹71,200.');
  say(qs, at(3, 15, 5), 'amit', 'Client asked for Hettich. Keep it.');
  say(qs, at(1, 10, 30), 'rohan', 'Gypsum vendor penalty: asking for a 2% credit for the late delivery.');
  say(qs, ago(75), 'rohan', 'Carpentry labour bill for week 1 submitted: ₹38,400.');

  // Sharma — #general
  const sg = sharma.ch.general;
  say(sg, at(9, 8, 50), 'amit', 'Welcome to Sharma Residence. Site address and client contact are on the project page.');
  say(sg, at(9, 8, 55), 'bot', 'Project moved to Execution', { type: 'system' });
  say(sg, at(8, 9, 0), 'meera', 'Reminder: site entry only with ID cards. Society rule.');
  say(sg, at(6, 12, 0), 'amit', 'Client visit this Saturday 11 am.');
  say(sg, at(6, 12, 10), 'kavya', "I'll be there with samples.");
  say(sg, at(4, 17, 30), 'suresh', 'Lift will be shut for maintenance tomorrow 10–12. Plan material movement.');
  say(sg, at(2, 10, 0), 'amit', 'Baseline is locked. Any date change now shows as variance.');
  say(sg, at(1, 13, 20), 'rohan', 'Petty cash topped up, ₹15,000 with Suresh.');
  say(sg, ago(110), 'amit', "We are 4 days behind baseline, mainly the gypsum delay. Let's recover it in carpentry.");
  say(sg, ago(50), 'suresh', 'Will add two carpenters from Monday.');

  // Mehta Villa
  const md = mehta.ch.design;
  say(md, at(6, 11, 0), 'kavya', 'Site measurement done. Villa is 3,400 sq ft across two floors.', photos(img('concrete', 'Ground floor – living')));
  say(md, at(5, 15, 0), 'kavya', 'Moodboard v1 — warm modern, lots of teak.', photos(img('plywood', 'Moodboard – teak'), img('sage', 'Moodboard – soft greens')));
  say(md, at(5, 16, 30), 'arjun', 'Like the direction. Mr Mehta prefers lighter wood, keep an oak option.');
  say(md, at(4, 10, 15), 'kavya', 'Adding an oak option.');
  say(md, at(3, 12, 0), 'kavya', 'Concept layouts A and B shared with the client.');
  say(md, at(2, 17, 45), 'kavya', 'Client picked layout B with a bigger pooja room.');
  say(md, at(1, 10, 0), 'kavya', 'Starting 3D renders for living and dining.');
  say(md, ago(140), 'kavya', 'First render draft by tomorrow evening.');
  say(mehta.ch.general, at(6, 9, 30), 'kavya', 'Mehta Villa kicked off. Design stage runs about two weeks.');
  say(mehta.ch.general, at(2, 18, 0), 'meera', 'Agreement signed copy received from client.');
  say(mehta.ch.general, ago(170), 'rohan', 'I will start the BOQ once layout B drawings are frozen.');
  say(mehta.ch.qs, at(3, 16, 0), 'rohan', 'Rough budget from client: ₹48 lakh all-in.');
  say(mehta.ch.qs, at(2, 11, 0), 'kavya', 'Keep 8% contingency in the estimate.');
  say(mehta.ch.qs, ago(160), 'rohan', 'Noted. First estimate by next Wednesday.');

  // Café Brew
  const cs = cafe.ch['site-work'];
  say(cs, at(5, 10, 0), 'suresh', 'Counter stone fixed. Polishing tomorrow.');
  say(cs, at(4, 11, 20), 'prakash', null, photos(img('tile', 'Bar counter – stone fixed')));
  say(cs, at(4, 11, 40), 'amit', 'Looks sharp.');
  say(cs, at(3, 15, 0), 'suresh', 'Signage backing ply done.');
  say(cs, at(2, 13, 10), 'lakshmi', 'Wall paint final coat finished in the seating area.', photos(img('sage', 'Seating area – final coat')));
  say(cs, at(2, 13, 30), 'amit', 'One day ahead of plan. Great work.', { reactions: { '🎉': ['suresh', 'lakshmi'] } });
  say(cs, at(1, 17, 0), 'suresh', 'Light fixtures arriving tomorrow.');
  say(cs, ago(170), 'prakash', 'Fixtures received. 22 pendant lights.');
  say(cs, ago(80), 'suresh', 'Pendant installation started.');
  say(cafe.ch.general, at(5, 9, 0), 'amit', 'Handover target is next week. Client wants a soft launch on the weekend after.');
  say(cafe.ch.general, at(3, 10, 0), 'meera', 'Fire NOC inspection is booked for Thursday.');
  say(cafe.ch.general, at(1, 12, 0), 'suresh', 'Deep cleaning team booked.');
  say(cafe.ch.general, ago(120), 'amit', 'Signage vendor confirmed install for day after tomorrow.');
  say(cafe.ch.design, at(4, 14, 0), 'amit', 'Signage artwork final from client attached.', file('CafeBrew_signage_final.pdf', 1240));
  say(cafe.ch.qs, at(2, 15, 0), 'amit', 'Pendant lights invoice: ₹1,12,000. Within budget.');

  // Company channels
  say(announcements, at(8, 9, 0), 'arjun', 'Welcome to Siteline. From today all project updates go here, not on WhatsApp.');
  say(announcements, at(5, 10, 0), 'meera', 'Diwali holidays: sites closed 20–22 Oct. Plan deliveries accordingly.');
  say(announcements, at(1, 18, 30), 'arjun', 'We won the Mehta Villa project. Kavya leads it. 🎉', { reactions: { '🎉': ['amit', 'kavya', 'suresh'] } });
  say(companyGeneral, at(7, 10, 0), 'meera', 'ID cards are ready. Collect from the office.');
  say(companyGeneral, at(6, 11, 0), 'suresh', 'Collected for the Sharma team.');
  say(companyGeneral, at(3, 9, 30), 'kavya', 'Anyone has the Asian Paints fan deck? Need it for Saturday.');
  say(companyGeneral, at(3, 9, 50), 'amit', "It's in my car. Will drop it at the studio.");
  say(companyGeneral, at(1, 16, 0), 'meera', 'Timesheets due Friday.');
  say(companyGeneral, ago(200), 'arjun', 'Good work on Café Brew, team. One day ahead.');

  // DMs
  say(dmAmitRavi, at(2, 8, 30), 'amit', 'Ravi, are you coming to site tomorrow?');
  say(dmAmitRavi, at(2, 8, 45), 'ravi', 'Yes sir, 9 am.');
  say(dmAmitRavi, at(1, 19, 0), 'amit', 'Good work on the living room ceiling.');
  say(dmAmitRavi, ago(140), 'amit', 'Send me a photo once the boarding is finished.');
  say(dmAmitSuresh, at(3, 20, 0), 'amit', 'Can we recover two days in carpentry?');
  say(dmAmitSuresh, at(3, 20, 15), 'suresh', 'Possible with two more carpenters. I will check with Imran.');
  say(dmAmitSuresh, at(1, 8, 10), 'suresh', 'Imran can bring two people from Monday.');
  say(dmAmitSuresh, ago(100), 'amit', 'Please go ahead. I will inform the client.');
  say(dmArjunAmit, at(4, 18, 0), 'arjun', 'How is Sharma looking?');
  say(dmArjunAmit, at(4, 18, 20), 'amit', '4 days behind because of gypsum boards. Recovery plan in carpentry.');
  say(dmArjunAmit, at(4, 18, 25), 'arjun', 'Ok. Keep the client informed.');
  say(dmArjunAmit, ago(90), 'arjun', 'Send me the revised finish date today please.');

  // Bot DMs
  for (const k of humanKeys) {
    say(botDm[k], at(8, 9, 1), 'bot', 'Hi! I will check in on your tasks here. Tap a button to answer — no typing needed.');
  }
  say(botDm.ravi, ago(420), 'bot', null, {
    data: {
      kind: 'morning_summary',
      taskIds: [T['False ceiling – living room'], T['False ceiling – master bedroom']],
    },
  });
  const ciTime = ago(6);
  const checkinId = uuidAt(ciTime);
  const checkinMsg = say(botDm.ravi, ciTime, 'bot', null, {
    type: 'checkin',
    data: { checkinId, taskId: T['False ceiling – living room'] },
  });
  const checkin: StoredCheckin = {
    id: checkinId,
    taskId: T['False ceiling – living room'],
    userId: U.ravi,
    askedAt: iso(ciTime),
    answer: null,
    messageId: checkinMsg,
    updatedAt: iso(ciTime),
    remindedAt: null,
    escalatedAt: null,
  };
  s.checkins.set(checkinId, checkin);

  // ---- Task history ----
  const hist = (taskName: string, user: UserKey, field: string, from: string | null, to: string | null, ms: number, via: 'app' | 'checkin' | 'system' = 'app') =>
    s.taskHistory.push({ id: uuidAt(ms), taskId: T[taskName], userId: U[user], field, from, to, via, createdAt: iso(ms) });
  hist('False ceiling – living room', 'ravi', 'status', 'not_started', 'in_progress', at(7, 9, 30));
  hist('False ceiling – living room', 'ravi', 'percent', '0', '25', at(6, 18, 4), 'checkin');
  hist('False ceiling – living room', 'amit', 'plannedFinish', day(-2), day(2), at(4, 10, 0));
  hist('False ceiling – living room', 'ravi', 'percent', '25', '50', at(3, 18, 2), 'checkin');
  hist('False ceiling – master bedroom', 'suresh', 'status', 'in_progress', 'blocked', at(6, 9, 30));
  hist('False ceiling – master bedroom', 'amit', 'plannedFinish', day(-1), day(3), at(4, 10, 0));
  hist('Kitchen carcass', 'imran', 'status', 'not_started', 'in_progress', at(3, 10, 5));
  hist('Kitchen carcass', 'suresh', 'percent', '0', '25', at(1, 18, 5));
  hist('Pendant lights', 'suresh', 'percent', '0', '50', ago(80));
  hist('3D renders – living & dining', 'kavya', 'status', 'not_started', 'in_progress', at(1, 10, 0));

  // ---- Activity ----
  const mentionRavi = [...s.messages.values()].find((m) => m.body?.startsWith('@Ravi'));
  const mentionSuresh = [...s.messages.values()].find((m) => m.body?.startsWith('@Suresh'));
  if (mentionRavi) {
    s.activities.push({
      id: uuidAt(Date.parse(mentionRavi.createdAt)),
      userId: U.ravi,
      kind: 'mention',
      actorId: U.amit,
      projectId: sharma.id,
      channelId: sw,
      messageId: mentionRavi.id,
      taskIds: [],
      text: 'Amit mentioned you in #site-work',
      lines: [mentionRavi.body ?? ''],
      createdAt: mentionRavi.createdAt,
    });
  }
  if (mentionSuresh) {
    s.activities.push({
      id: uuidAt(Date.parse(mentionSuresh.createdAt)),
      userId: U.suresh,
      kind: 'mention',
      actorId: U.amit,
      projectId: sharma.id,
      channelId: sw,
      messageId: mentionSuresh.id,
      taskIds: [],
      text: 'Amit mentioned you in #site-work',
      lines: [mentionSuresh.body ?? ''],
      createdAt: mentionSuresh.createdAt,
    });
  }
  s.activities.push({
    id: uuidAt(at(3, 18, 2)),
    userId: U.amit,
    kind: 'checkin_result',
    actorId: U.ravi,
    projectId: sharma.id,
    channelId: sw,
    messageId: null,
    taskIds: [T['False ceiling – living room']],
    text: 'Ravi updated False ceiling – living room to 50%',
    lines: [],
    createdAt: iso(at(3, 18, 2)),
  });
  s.activities.push({
    id: uuidAt(at(6, 9, 48)),
    userId: U.suresh,
    kind: 'thread_reply',
    actorId: U.ravi,
    projectId: sharma.id,
    channelId: sw,
    messageId: thread,
    taskIds: [],
    text: 'Ravi replied to your message in #site-work',
    lines: ['Ok sir, we will continue living room till then.'],
    createdAt: iso(at(6, 9, 48)),
  });
  s.activities.push({
    id: uuidAt(at(7, 9, 0)),
    userId: U.ravi,
    kind: 'task_assigned',
    actorId: U.amit,
    projectId: sharma.id,
    channelId: null,
    messageId: null,
    taskIds: [T['False ceiling – living room']],
    text: 'Amit assigned you False ceiling – living room',
    lines: [],
    createdAt: iso(at(7, 9, 0)),
  });

  // ---- Read markers: leave a few unread messages per channel for everyone ----
  const byChannel = new Map<ID, Message[]>();
  for (const m of s.messages.values()) {
    if (m.threadParentId) continue;
    const list = byChannel.get(m.channelId) ?? [];
    list.push(m);
    byChannel.set(m.channelId, list);
  }
  for (const list of byChannel.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  let n = 0;
  for (const cm of s.channelMembers) {
    const list = byChannel.get(cm.channelId) ?? [];
    if (list.length === 0) continue;
    const ch = s.channels.get(cm.channelId);
    // Bot DM with the open check-in stays unread; other channels rotate 0–3 unread.
    // Busy channels always have something new.
    const busy = ch?.name === 'site-work' || ch?.name === 'design' || ch?.name === 'announcements';
    const unread = ch?.kind === 'bot' ? (cm.userId === U.ravi ? 2 : 0) : n++ % 4 || (busy ? 2 : 0);
    const idx = list.length - 1 - unread;
    cm.lastReadMessageId = idx >= 0 ? list[idx].id : null;
  }

  return s;
}

registerSeed(build);
