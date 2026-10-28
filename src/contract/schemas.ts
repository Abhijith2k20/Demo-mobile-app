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

export const otpRequestSchema = z.object({ email: z.email('Enter a valid email address') });
export const otpVerifySchema = z.object({ email: z.email(), code: z.string().length(6) });

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

export const checkinAnswerSchema = z.object({
  kind: z.enum(['started', 'progress', 'problem', 'done', 'not_started']),
  percent: z.number().int().min(0).max(100).optional(),
  reason: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  voiceSec: z.number().int().min(1).max(600).optional(),
  hasPhoto: z.boolean().optional(),
});

export const memberAddSchema = z.object({
  userId: id,
  role: z.enum(['manager', 'member']),
  jobTitle: z.string().min(1), // the company's own titles; the server checks them
  channelIds: z.array(id),
});
export const memberPatchSchema = memberAddSchema.omit({ userId: true }).partial();

export const projectPatchSchema = z
  .object({
    stage: z.string().min(1), // the company's own stages; the server checks them
    name: z.string().trim().min(2, 'Give the project a name').max(80),
    client: z.string().trim().min(1, 'Who is the client?').max(80),
    address: z.string().trim().max(160),
    archived: z.boolean(),
  })
  .partial();
export const projectDetailsSchema = projectPatchSchema.required({ name: true, client: true, address: true }).omit({ stage: true, archived: true });

/** Channel names look like "team-updates": lowercase letters, numbers and hyphens. */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
const channelName = z
  .string()
  .min(2, 'Use at least 2 letters')
  .max(30, 'Keep it under 30 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');
export const channelCreateSchema = z.object({
  id,
  name: channelName,
  isPrivate: z.boolean(),
  memberIds: z.array(id),
});
export const channelPatchSchema = z
  .object({ name: channelName, isPrivate: z.boolean(), memberIds: z.array(id) })
  .partial();
export const projectCreateSchema = z.object({
  id,
  name: z.string().trim().min(2, 'Give the project a name').max(80),
  client: z.string().trim().min(1, 'Who is the client?').max(80),
  address: z.string().trim().max(160),
});
export const userInviteSchema = z.object({
  id,
  name: z.string().trim().min(2, 'Enter their name').max(60),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid work email')),
  companyRole: z.enum(['member', 'admin']),
});
export type UserInvite = z.infer<typeof userInviteSchema>;
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

/** Always offered after the company's own problem types; needs a description. */
export const OTHER_PROBLEM = 'Other';

export const issueFormSchema = z
  .object({
    what: z.string().min(1, "Pick what's wrong"),
    note: z.string().max(500),
    taskId: z.string().nullable(),
    urgency: z.enum(['normal', 'urgent']),
  })
  .refine((v) => v.what !== OTHER_PROBLEM || v.note.trim().length > 0, {
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
