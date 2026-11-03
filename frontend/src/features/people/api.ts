import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/api/client';
import { attempt, submit } from '@/lib/mutations';
import { keys } from '@/lib/queries';
import type { CompanyRole, SentInvite, User, UserView } from '@/types/models';
import type { InviteInput } from '@/contract/schemas';

/**
 * Invites a person by work email. They join by signing in with it (spec §9.5).
 * The server checks the role and whether they're already in the company; errors come back for the form.
 */
export function invitePerson(input: InviteInput) {
  return submit(async () => (await api<{ invite: SentInvite }>('POST', '/invites', { id: uuidv7(), ...input })).invite, [keys.invites]);
}

export function resendInvite(invite: SentInvite): Promise<unknown> {
  return attempt(() => api('POST', `/invites/${invite.id}/resend`), [keys.invites]);
}

export function cancelInvite(invite: SentInvite): Promise<unknown> {
  return attempt(() => api('DELETE', `/invites/${invite.id}`), [keys.invites]);
}

/** Owner: Admin / Member / Guest. Admins: Member / Guest. The server decides who may do what. */
export function changeRole(user: Pick<User, 'id'>, role: Exclude<CompanyRole, 'owner'>): Promise<unknown> {
  return attempt(() => api<{ user: UserView }>('PATCH', `/users/${user.id}`, { role }), [keys.users, keys.projects, keys.channels]);
}

/** Archive, never delete: they can't open this company or be picked; their history stays. */
export function deactivatePerson(user: Pick<User, 'id' | 'name'>): Promise<unknown> {
  return attempt(() => api('POST', `/users/${user.id}/deactivate`), [keys.users, keys.projects]);
}
