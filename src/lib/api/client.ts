import { uuidv7 } from 'uuidv7';
import type { ApiErrorBody } from '@/contract/errorCodes';
import { useDemo } from '@/stores/demo';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { request, TransportError, type TransportRequest } from './transport';

export type ErrorKind =
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'server';

export class AppError extends Error {
  kind: ErrorKind;
  code: string;
  details: { fields?: Record<string, string> } & Record<string, unknown>;
  requestId: string;
  constructor(kind: ErrorKind, code: string, message: string, details: AppError['details'], requestId: string) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

function kindForStatus(status: number): ErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'validation';
  if (status === 429) return 'rate_limited';
  return 'server';
}

let onAuthLost: () => void = () => {};
/** Called when the session can't be recovered: the app wipes local data and shows login. */
export function setAuthLostHandler(fn: () => void): void {
  onAuthLost = fn;
}

async function send<T>(method: TransportRequest['method'], path: string, body: unknown, form?: FormData): Promise<T> {
  const requestId = `req_${uuidv7()}`;
  const token = useSession.getState().accessToken;
  // The language picks the labels of the company's own setup (stages, job titles).
  const headers: Record<string, string> = { 'X-Request-Id': requestId, 'Accept-Language': useUi.getState().language };
  if (token) headers.Authorization = `Bearer ${token}`;
  const started = Date.now();
  const log = (status: number | 'offline' | 'timeout', code?: string) =>
    useDemo.getState().logApi({ method, path, status, ms: Date.now() - started, requestId, code });
  try {
    const res = await request({ method, path, body, form, headers });
    useUi.getState().set({ online: true });
    if (res.status >= 200 && res.status < 300) {
      log(res.status);
      return res.body as T;
    }
    const err = (res.body as ApiErrorBody | null)?.error;
    log(res.status, err?.code);
    throw new AppError(
      kindForStatus(res.status),
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Request failed',
      err?.details ?? {},
      err?.request_id ?? requestId,
    );
  } catch (e) {
    if (e instanceof TransportError) {
      if (e.kind === 'offline') useUi.getState().set({ online: false });
      log(e.kind);
      throw new AppError(e.kind, e.kind === 'offline' ? 'OFFLINE' : 'TIMEOUT', e.kind, {}, requestId);
    }
    if (e instanceof AppError) throw e;
    log(500, 'UNKNOWN');
    throw new AppError('server', 'UNKNOWN', e instanceof Error ? e.message : 'Unknown error', {}, requestId);
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: concurrent 401s all wait on the same promise. */
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = useSession.getState().refreshToken;
      if (!refreshToken) return false;
      try {
        const res = await send<{ accessToken: string }>('POST', '/auth/refresh', { refreshToken });
        useSession.getState().setAccessToken(res.accessToken);
        return true;
      } catch (e) {
        // Only a definite "no" ends the session; a network blip must not log the user out.
        if (isAppError(e) && e.kind === 'auth') return false;
        throw e;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** The one function every feature uses to talk to the server. */
export async function api<T>(method: TransportRequest['method'], path: string, body?: unknown, form?: FormData): Promise<T> {
  try {
    return await send<T>(method, path, body, form);
  } catch (e) {
    if (!isAppError(e) || e.kind !== 'auth' || path.startsWith('/auth/')) throw e;
    const ok = await refreshOnce();
    if (!ok) {
      onAuthLost();
      throw e;
    }
    try {
      return await send<T>(method, path, body, form);
    } catch (again) {
      if (isAppError(again) && again.kind === 'auth') onAuthLost();
      throw again;
    }
  }
}
