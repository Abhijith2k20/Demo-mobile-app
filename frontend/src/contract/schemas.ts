import { z } from 'zod';

const id = z.string().min(8);

export const projectPatchSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the project a name').max(80),
    client: z.string().trim().max(80),
    address: z.string().trim().max(160),
    archived: z.boolean(),
  })
  .partial();
export const projectDetailsSchema = projectPatchSchema.required({ name: true, client: true, address: true }).omit({ archived: true });

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
export const projectCreateSchema = z.object({
  id,
  name: z.string().trim().min(2, 'Give the project a name').max(80),
  client: z.string().trim().max(80),
  address: z.string().trim().max(160),
});
/** Instant feedback only: the server normalises the email or phone and checks it again. */
export const inviteSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(60),
  identifier: z
    .string()
    .trim()
    .refine((v) => (v.includes('@') ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) : v.replace(/\D/g, '').length >= 10), 'Enter a work email or a phone number'),
  role: z.enum(['admin', 'member', 'guest']),
  channelIds: z.array(z.string()),
});
export type InviteInput = z.infer<typeof inviteSchema>;
