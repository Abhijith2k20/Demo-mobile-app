import { api } from '@/lib/api/client';
import { startSession, type LoginResult } from '@/lib/session';

export async function requestOtp(phone: string): Promise<{ resendInSeconds: number }> {
  return api<{ sent: boolean; resendInSeconds: number }>('POST', '/auth/otp/request', { phone });
}

/** Verifies the code, stores the tokens in memory and runs the first sync. */
export async function verifyOtp(phone: string, code: string): Promise<void> {
  const res = await api<LoginResult>('POST', '/auth/otp/verify', { phone, code });
  await startSession(res);
}

export const formatPhone = (digits: string): string => {
  const d = digits.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
};
