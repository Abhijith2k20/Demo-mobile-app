import { uuidv7 } from 'uuidv7';
import { api } from '@/lib/api/client';
import { attempt, submit } from '@/lib/mutations';
import { keys } from '@/lib/queries';
import type { User, UserView } from '@/types/models';

/**
 * Invites a person to the company: they can sign in with their work email straight away.
 * The server checks the role and that the email isn't already in use; errors come back for the form.
 */
export function invitePerson(input: { name: string; email: string; companyRole: 'member' | 'admin' }) {
  return submit(async () => (await api<{ user: UserView }>('POST', '/users', { id: uuidv7(), ...input })).user, [keys.users]);
}

/** Archive, never delete: they can't sign in or be picked; their history stays. */
export function deactivatePerson(user: Pick<User, 'id' | 'name'>): Promise<unknown> {
  return attempt(() => api('POST', `/users/${user.id}/deactivate`), [keys.users, keys.projects]);
}
