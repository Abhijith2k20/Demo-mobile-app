import { api } from '@/lib/api/client';
import { startSession, type LoginResult } from '@/lib/session';

export async function requestOtp(email: string): Promise<{ resendInSeconds: number }> {
  return api<{ sent: boolean; resendInSeconds: number }>('POST', '/auth/otp/request', { email });
}

/** Verifies the code, stores the tokens in memory and runs the first sync. */
export async function verifyOtp(email: string, code: string): Promise<void> {
  const res = await api<LoginResult>('POST', '/auth/otp/verify', { email, code });
  await startSession(res);
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();
