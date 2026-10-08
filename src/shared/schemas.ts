import { z } from 'zod';

const id = z.string().min(8);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

export const messageTypes = [
  'text',
  'image',
  'voice',
  'file',
  'task_card',
  'checkin',
  'issue_card',
  'daily_report',
  'status_card',
  'system',
] as const;

export const otpRequestSchema = z.object({ phone: z.string().min(10, 'Enter a 10-digit number') });
export const otpVerifySchema = z.object({ phone: z.string().min(10), code: z.string().length(6) });

export const messageCreateSchema = z.object({
  id,
  type: z.enum(messageTypes),
  body: z.string().max(4000).nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  threadParentId: id.nullable(),
});
export type MessageCreate = z.infer<typeof messageCreateSchema>;

export const messagePatchSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  pinned: z.boolean().optional(),
});

export const taskStatuses = ['not_started', 'in_progress', 'blocked', 'done', 'done_pending_confirmation'] as const;

export const taskCreateSchema = z
  .object({
    id,
    name: z.string().trim().min(1, 'Give the task a name').max(120),
    phase: z.string().min(1),
    ownerId: id.nullable(),
    plannedStart: isoDate,
    plannedFinish: isoDate,
    description: z.string().max(2000).nullable(),
    channelId: id.nullable(),
  })
  .refine((v) => v.plannedFinish >= v.plannedStart, {
    path: ['plannedFinish'],
    message: 'Finish must be on or after start',
  });
export type TaskCreate = z.infer<typeof taskCreateSchema>;

export const taskPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable(),
    phase: z.string().min(1),
    ownerId: id.nullable(),
    plannedStart: isoDate,
    plannedFinish: isoDate,
    status: z.enum(taskStatuses),
    percent: z.number().int().min(0).max(100),
  })
  .partial();
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const checkinAnswerSchema = z.object({
  kind: z.enum(['started', 'progress', 'problem', 'done', 'not_started']),
  percent: z.number().int().min(0).max(100).optional(),
  reason: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  hasPhoto: z.boolean().optional(),
});

export const memberAddSchema = z.object({
  userId: id,
  role: z.enum(['manager', 'member']),
  jobTitle: z.enum(['Project Manager', 'Designer', 'QS', 'Supervisor', 'Worker']),
  channelIds: z.array(id),
});
export const memberPatchSchema = memberAddSchema.omit({ userId: true }).partial();

export const projectPatchSchema = z.object({
  stage: z.enum(['design', 'approval', 'procurement', 'execution', 'finishing', 'handover']),
});
export const projectCreateSchema = z.object({
  id,
  name: z.string().trim().min(2, 'Give the project a name').max(80),
  client: z.string().trim().min(1, 'Who is the client?').max(80),
  address: z.string().trim().max(160),
});
export const rebaselineSchema = z.object({ reason: z.string().trim().min(3, 'Give a short reason') });

// ---- In-chat forms (§6) ----

export const newTaskFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the task a name').max(120),
    phase: z.string().min(1, 'Pick a phase'),
    ownerId: z.string().nullable(),
    plannedStart: isoDate,
    plannedFinish: isoDate,
    description: z.string().max(2000),
  })
  .refine((v) => v.plannedFinish >= v.plannedStart, {
    path: ['plannedFinish'],
    message: 'Finish must be on or after start',
  });
export type NewTaskForm = z.infer<typeof newTaskFormSchema>;

export const ISSUE_PRESETS = ['Material not arrived', 'Waiting for design', 'Labour short', 'Damage', 'Other'] as const;

export const issueFormSchema = z
  .object({
    what: z.string().min(1, "Pick what's wrong"),
    note: z.string().max(500),
    taskId: z.string().nullable(),
    urgency: z.enum(['normal', 'urgent']),
  })
  .refine((v) => v.what !== 'Other' || v.note.trim().length > 0, {
    path: ['note'],
    message: 'Describe the problem',
  });
export type IssueForm = z.infer<typeof issueFormSchema>;

export const dailyReportFormSchema = z.object({
  workDone: z.string().trim().min(1, 'Say what was done today').max(1000),
  workers: z.number().int().min(0).max(200),
  problems: z.string().max(1000),
  tomorrow: z.string().max(1000),
});
export type DailyReportForm = z.infer<typeof dailyReportFormSchema>;
