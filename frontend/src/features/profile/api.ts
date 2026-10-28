import { api } from '@/lib/api/client';
import { endSession } from '@/lib/session';

/** Signs out on the server (tokens revoked) and clears this phone. */
export function logOut(): void {
  api('POST', '/auth/logout').catch(() => {});
  endSession({ discardQueue: true });
}
