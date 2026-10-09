// Check-ins, uploads, dashboard and the company directory.
import { addDays, format } from 'date-fns';
import { z } from 'zod';
import { isCompanyAdmin } from '@/shared/permissions';
import { checkinAnswerSchema } from '@/shared/schemas';
import { isDone, projectDelayDays, todayIso } from '@/shared/taskRules';
import type { Attachment, Checkin, DashboardResponse, ID, Stage } from '@/types/models';
import { STAGES } from '@/types/models';
import { assertProjectActive, humans, store, type StoredCheckin } from '../db';
import { applyCheckinAnswer, askAboutOpenTasks } from '../bot';
import { publish } from '../events';
import { forbidden, notFound, parse, route, type RouteDef } from '../http';
import { firstName, shortProject } from '../notify';
import { publicUser } from './auth';

export function publicCheckin(c: StoredCheckin): Checkin {
  return { id: c.id, taskId: c.taskId, userId: c.userId, askedAt: c.askedAt, answer: c.answer };
}

const uploadSchema = z.object({ clientId: z.string().min(8), name: z.string().optional() });
const uploadPutSchema = z.object({ uri: z.string().min(1) });

export const miscRoutes: RouteDef[] = [
  route('POST', '/checkins/:id/answer', ({ user, params, body }) => {
    const c = store().checkins.get(params.id);
    if (!c || c.userId !== user.id) throw notFound('Check-in');
    const answer = parse(checkinAnswerSchema, body);
    if (!c.answer) {
      assertProjectActive(store().tasks.get(c.taskId)?.projectId);
      applyCheckinAnswer(c, answer); // idempotent by check-in id: a repeat changes nothing
      publish({ type: 'checkin.new', checkin: publicCheckin(c) }, [user.id]);
    }
    return publicCheckin(c);
  }),

  // Demo addition: the app calls this when the bot conversation is opened.
  route('POST', '/bot/checkins', ({ user }) => ({ asked: askAboutOpenTasks(user.id) })),

  route('POST', '/uploads', ({ user, body }) => {
    const s = store();
    const { clientId } = parse(uploadSchema, body);
    if (!s.uploads.has(clientId)) s.uploads.set(clientId, { id: clientId, userId: user.id, uri: null, done: false });
    return { uploadId: clientId, uploadUrl: `/uploads/${clientId}/content` };
  }),

  route('PUT', '/uploads/:id/content', ({ user, params, body }) => {
    const u = store().uploads.get(params.id);
    if (!u || u.userId !== user.id) throw notFound('Upload');
    const { uri } = parse(uploadPutSchema, body);
    u.uri = uri; // simulated storage: we keep the local file URI
    u.done = true;
    return { uploadId: u.id, url: uri };
  }),

  route('GET', '/users', () => ({
    users: humans().map(publicUser),
  })),

  route('GET', '/dashboard', ({ user }): DashboardResponse => {
    if (!isCompanyAdmin(user)) throw forbidden('The dashboard is for the owner and admins.');
    const s = store();
    // Archived projects are out of the picture for the dashboard.
    const projects = [...s.projects.values()].filter((p) => !p.archivedAt);
    const live = new Set(projects.map((p) => p.id));
    const tasks = [...s.tasks.values()].filter((t) => !t.deletedAt && live.has(t.projectId));
    const today = todayIso();
    const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const delayed = projects
      .map((p) => ({ p, days: projectDelayDays(p) }))
      .filter((x) => x.days > 0)
      .sort((a, b) => b.days - a.days);
    const byStage = STAGES.map((stage: Stage) => ({ stage, count: projects.filter((p) => p.stage === stage).length }));
    const since = Date.now() - 36 * 3600 * 1000;
    const todayOnSites = [...s.messages.values()]
      .filter(
        (m) =>
          !m.deletedAt &&
          Date.parse(m.createdAt) > since &&
          (m.type === 'status_card' || m.type === 'daily_report' || m.type === 'image'),
      )
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, 8)
      .map((m) => {
        const ch = s.channels.get(m.channelId);
        const d = m.data ?? {};
        const who = (d.userId as ID | undefined) ?? m.senderId;
        let text = m.body ?? '';
        if (m.type === 'status_card') {
          const a = d.answer as { kind?: string; percent?: number; reason?: string } | undefined;
          text =
            (d.text as string | undefined) ??
            `${firstName(who)} · ${d.taskName as string} → ${
              a?.kind === 'progress' ? `${a.percent}%` : a?.kind === 'problem' ? `Problem: ${a.reason ?? ''}` : a?.kind === 'done' ? 'Done' : a?.kind === 'not_started' ? 'Not started' : 'Started'
            }`;
        } else if (m.type === 'daily_report') {
          text = `Daily report: ${d.workDone as string}`;
        } else if (!text) {
          text = `${firstName(who)} shared photos`;
        }
        return {
          id: m.id,
          projectName: ch?.projectId ? shortProject(ch.projectId) : 'Company',
          userId: who,
          text,
          at: m.createdAt,
          attachments: (d.attachments as Attachment[] | undefined) ?? [],
        };
      });
    return {
      generatedAt: new Date().toISOString(),
      stats: {
        activeProjects: projects.filter((p) => p.stage !== 'handover').length,
        delayed: delayed.length,
        dueThisWeek: tasks.filter((t) => !isDone(t.status) && t.plannedFinish >= today && t.plannedFinish <= weekEnd).length,
        blocked: tasks.filter((t) => t.status === 'blocked').length,
      },
      byStage,
      delayedProjects: delayed.map(({ p, days }) => ({
        id: p.id,
        name: p.name,
        stage: p.stage,
        daysBehind: days,
        pmId: s.projectMembers.find((m) => m.projectId === p.id && m.jobTitle === 'Project Manager')?.userId ?? null,
      })),
      todayOnSites,
    };
  }),
];
