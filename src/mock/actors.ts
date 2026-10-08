// Scripted teammates (§10.6): they act on a timer so the app feels alive.
import { addDays, format, parseISO } from 'date-fns';
import { uuidv7 } from 'uuidv7';
import type { Attachment, ID, PhotoTone, Task } from '@/types/models';
import { projectChannel, store } from './db';
import { getNetwork } from './network';
import { act } from './server';

let timer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
let step = 0;
let shiftForward = false;
const listeners = new Set<(paused: boolean) => void>();

const userByName = (name: string): ID | null =>
  [...store().users.values()].find((u) => u.name.startsWith(name))?.id ?? null;
const projectByName = (name: string): ID | null =>
  [...store().projects.values()].find((p) => p.name.startsWith(name))?.id ?? null;

const img = (tone: PhotoTone, caption: string): Attachment => ({
  id: uuidv7(),
  kind: 'image',
  uri: null,
  uploadId: null,
  caption,
  tone,
});

function post(userName: string, projectName: string | null, channelName: string, body: string | null, photos: Attachment[] = []): void {
  const userId = userByName(userName);
  if (!userId) return;
  const s = store();
  const ch = projectName
    ? projectChannel(projectByName(projectName) ?? '', channelName)
    : [...s.channels.values()].find((c) => c.kind === 'company' && c.name === channelName);
  if (!ch) return;
  act(userId, 'POST', `/channels/${ch.id}/messages`, {
    id: uuidv7(),
    type: photos.length ? 'image' : 'text',
    body,
    data: photos.length ? { attachments: photos } : null,
    threadParentId: null,
  });
}

const pick = <T,>(list: T[], i: number): T => list[i % list.length];

export function kavyaPostsDesign(): void {
  const n = step;
  post(
    'Kavya',
    'Sharma',
    'design',
    pick(['Updated wardrobe shutter detail.', 'Revised the foyer panel joinery.', 'Kitchen upper unit heights adjusted.'], n),
    [img('plywood', pick(['Shutter detail', 'Foyer joinery', 'Upper unit section'], n)), img('tile', pick(['Elevation', 'Plan view', 'Side elevation'], n))],
  );
}

export function sureshPostsSite(): void {
  const n = step;
  post('Suresh', 'Sharma', 'site-work', pick(['Site photos from this hour.', 'Progress update from site.', 'Carpentry moving well today.'], n), [
    img('concrete', pick(['Master bedroom ceiling', 'Living room cove', 'Kids bedroom grid'], n)),
    img('plywood', pick(['Kitchen uppers', 'Wardrobe carcass', 'TV unit base'], n)),
  ]);
  const userId = userByName('Suresh');
  const task = [...store().tasks.values()].find((t) => t.name === 'Kitchen carcass');
  if (userId && task && task.percent < 90) {
    act(userId, 'PATCH', `/tasks/${task.id}`, { percent: Math.min(90, task.percent + 5) });
  }
}

export function rohanPostsQs(): void {
  post(
    'Rohan',
    'Sharma',
    'qs',
    pick(
      [
        'Laminate quote received: ₹1,450/sheet, within budget.',
        'Paint estimate revised to ₹86,000 after shade change.',
        'Vendor agreed to the 2% credit on gypsum boards.',
      ],
      step,
    ),
  );
}

export function amitShiftsTasks(): void {
  const userId = userByName('Amit');
  const projectId = projectByName('Sharma');
  if (!userId || !projectId) return;
  const candidates: Task[] = [...store().tasks.values()]
    .filter((t) => t.projectId === projectId && t.status === 'not_started' && !t.deletedAt)
    .sort((a, b) => (a.plannedStart < b.plannedStart ? -1 : 1))
    .slice(0, 5);
  // Alternate a day later / a day earlier so a long demo doesn't drift the whole schedule.
  shiftForward = !shiftForward;
  const by = shiftForward ? 1 : -1;
  const shift = (d: string) => format(addDays(parseISO(d), by), 'yyyy-MM-dd');
  for (const t of candidates) {
    act(userId, 'PATCH', `/tasks/${t.id}`, { plannedStart: shift(t.plannedStart), plannedFinish: shift(t.plannedFinish) });
  }
}

export function ownerAnnounces(): void {
  post(
    'Arjun',
    null,
    'announcements',
    pick(['Monthly review is on the 15th. PMs, please update your schedules.', 'Safety reminder: helmets on at all sites.'], step),
  );
}

const script = [kavyaPostsDesign, sureshPostsSite, rohanPostsQs, amitShiftsTasks, sureshPostsSite, kavyaPostsDesign, ownerAnnounces];

function loggedIn(): boolean {
  return [...store().tokens.values()].some((t) => !t.expired);
}

function tick(): void {
  timer = null;
  if (!paused && getNetwork().mode === 'online' && loggedIn()) {
    try {
      script[step % script.length]();
    } catch (e) {
      console.warn('[mock actors]', e);
    }
    step++;
  }
  plan();
}

function plan(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, 20_000 + Math.random() * 20_000);
}

export function startActors(): void {
  if (!timer) plan();
}

export function setActorsPaused(value: boolean): void {
  paused = value;
  for (const fn of listeners) fn(paused);
}
export const actorsPaused = (): boolean => paused;
export function onActorsChange(fn: (paused: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function resetActors(): void {
  step = 0;
  shiftForward = false;
  paused = false;
  for (const fn of listeners) fn(paused);
}
