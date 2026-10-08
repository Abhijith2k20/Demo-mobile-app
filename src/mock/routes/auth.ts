import { uuidv7 } from 'uuidv7';
import { otpRequestSchema, otpVerifySchema } from '@/shared/schemas';
import type { ID, User } from '@/types/models';
import { store, type StoredUser } from '../db';
import { MockError, parse, route, type RouteDef } from '../http';
import { onLogin } from '../bot';

export const DEMO_OTP = '123456';
const MAX_ATTEMPTS = 5;

export function publicUser(u: StoredUser): User & { online: boolean } {
  const { updatedAt: _u, ...rest } = u;
  return rest;
}

function issueTokens(userId: ID): { accessToken: string; refreshToken: string } {
  const s = store();
  const accessToken = `at_${uuidv7()}`;
  const refreshToken = `rt_${uuidv7()}`;
  s.tokens.set(accessToken, { userId, kind: 'access', expired: false });
  s.tokens.set(refreshToken, { userId, kind: 'refresh', expired: false });
  return { accessToken, refreshToken };
}

const normalise = (phone: string) => phone.replace(/\D/g, '').slice(-10);

export const authRoutes: RouteDef[] = [
  route(
    'POST',
    '/auth/otp/request',
    ({ body }) => {
      const { phone } = parse(otpRequestSchema, body);
      store().otpAttempts.set(normalise(phone), 0);
      // Same answer for known and unknown numbers.
      return { sent: true, resendInSeconds: 30 };
    },
    true,
  ),
  route(
    'POST',
    '/auth/otp/verify',
    ({ body }) => {
      const s = store();
      const input = parse(otpVerifySchema, body);
      const phone = normalise(input.phone);
      const attempts = s.otpAttempts.get(phone) ?? 0;
      if (attempts >= MAX_ATTEMPTS) {
        throw new MockError('OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Request a new code.');
      }
      const user = [...s.users.values()].find((u) => u.phone === phone && u.id !== s.botId);
      if (input.code !== DEMO_OTP || !user || !user.isActive) {
        s.otpAttempts.set(phone, attempts + 1);
        if (attempts + 1 >= MAX_ATTEMPTS) {
          throw new MockError('OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Request a new code.');
        }
        throw new MockError('OTP_INVALID', 'That code is not right.', { attemptsLeft: MAX_ATTEMPTS - attempts - 1 });
      }
      s.otpAttempts.delete(phone);
      onLogin(user.id);
      return { ...issueTokens(user.id), user: publicUser(user) };
    },
    true,
  ),
  route(
    'POST',
    '/auth/refresh',
    ({ body }) => {
      const s = store();
      const token = (body as { refreshToken?: string } | null)?.refreshToken ?? '';
      const entry = s.tokens.get(token);
      const user = entry ? s.users.get(entry.userId) : undefined;
      if (!entry || entry.kind !== 'refresh' || entry.expired || !user || !user.isActive) {
        throw new MockError('AUTH_EXPIRED', 'Please sign in again.');
      }
      const accessToken = `at_${uuidv7()}`;
      s.tokens.set(accessToken, { userId: user.id, kind: 'access', expired: false });
      return { accessToken };
    },
    true,
  ),
];

// ---- Demo panel helpers ----

export function expireAccessTokens(userId: ID): void {
  for (const t of store().tokens.values()) {
    if (t.userId === userId && t.kind === 'access') t.expired = true;
  }
}

export function deactivateUser(userId: ID): void {
  const s = store();
  const u = s.users.get(userId);
  if (u) u.isActive = false;
  for (const t of s.tokens.values()) if (t.userId === userId) t.expired = true;
}
