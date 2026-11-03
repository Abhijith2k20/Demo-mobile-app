import { api } from '@/lib/api/client';
import { holdAccountToken, pickCompany, startSession, type SignedIn } from '@/lib/session';
import type { CompanyChoice, PendingInvite } from '@/types/models';

export interface CodeSent {
  resendInSeconds: number;
}

/** Sends a sign-in code to a work email. The reply is the same whether or not the address is known. */
export function requestCode(identifier: string): Promise<CodeSent> {
  return api<CodeSent>('POST', '/auth/otp/request', { identifier: identifier.trim() });
}

/**
 * Checks the code. With exactly one company and no invites the session starts at once (returns null);
 * otherwise it returns the companies and invites for the picker.
 */
export async function verifyCode(identifier: string, code: string): Promise<SignedIn | null> {
  const res = await api<SignedIn>('POST', '/auth/otp/verify', { identifier: identifier.trim(), code });
  if (res.session) {
    await startSession(res.session);
    return null;
  }
  holdAccountToken(res.accessToken);
  return res;
}

export interface Choices {
  companies: CompanyChoice[];
  invites: PendingInvite[];
}

export const loadChoices = (): Promise<Choices> => api<Choices>('GET', '/auth/companies');
export const acceptInvite = (id: string): Promise<Choices> => api<Choices>('POST', `/auth/invites/${id}/accept`);
export const declineInvite = (id: string): Promise<Choices> => api<Choices>('POST', `/auth/invites/${id}/decline`);
export const openCompany = (id: string): Promise<void> => pickCompany(id);

/** A rough check before asking the server (which decides): does it look like an email? */
export function looksLikeIdentifier(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}
