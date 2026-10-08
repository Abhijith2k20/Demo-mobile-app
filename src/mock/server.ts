// In-process mock server: (method, path, body, auth) → response | error.
// Behaves like the planned FastAPI server: same paths, same error format, same events.
import { uuidv7 } from 'uuidv7';
import type { ApiErrorBody } from '@/shared/errorCodes';
import type { ID } from '@/types/models';
import './seed';
import { resetBot } from './bot';
import { resetStore, store, type StoredUser } from './db';
import { matchRoute, MockError, type RouteDef } from './http';
import { getNetwork, latencyMs, resetNetwork, rollFlakyTimeout, sleep, takeInjection, TIMEOUT_MS } from './network';
import { resetNotify } from './notify';
import { authRoutes } from './routes/auth';
import { messageRoutes } from './routes/messages';
import { miscRoutes } from './routes/misc';
import { projectRoutes } from './routes/projects';
import { syncRoutes } from './routes/sync';
import { taskRoutes } from './routes/tasks';

export interface MockRequest {
  method: string;
  path: string;
  body?: unknown;
  headers: Record<string, string>;
}
export interface MockResponse {
  status: number;
  body: unknown;
}
export class NetworkFailure extends Error {
  kind: 'offline' | 'timeout';
  constructor(kind: 'offline' | 'timeout') {
    super(kind);
    this.kind = kind;
  }
}

const routes: RouteDef[] = [
  ...authRoutes,
  ...syncRoutes,
  ...messageRoutes,
  ...taskRoutes,
  ...projectRoutes,
  ...miscRoutes,
];

function errorBody(code: string, message: string, details: Record<string, unknown>, requestId: string): ApiErrorBody {
  return { error: { code, message, details, request_id: requestId } };
}

function authenticate(headers: Record<string, string>): StoredUser {
  const s = store();
  const token = (headers.Authorization ?? '').replace(/^Bearer\s+/i, '');
  const entry = s.tokens.get(token);
  const user = entry ? s.users.get(entry.userId) : undefined;
  if (!entry || entry.kind !== 'access' || entry.expired || !user || !user.isActive) {
    throw new MockError('AUTH_EXPIRED', 'Your session has expired.');
  }
  return user;
}

function dispatch(req: MockRequest, requestId: string, asUser?: StoredUser): MockResponse {
  const [pathname, queryString = ''] = req.path.split('?');
  const parts = pathname.split('/').filter(Boolean);
  const query: Record<string, string> = {};
  for (const pair of queryString.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  try {
    for (const def of routes) {
      const params = matchRoute(def, req.method, parts);
      if (!params) continue;
      const user = asUser ?? (def.isPublic ? (undefined as unknown as StoredUser) : authenticate(req.headers));
      return { status: 200, body: def.handler({ user, params, query, body: req.body }) };
    }
    throw new MockError('NOT_FOUND', 'Not found.');
  } catch (e) {
    if (e instanceof MockError) {
      return { status: e.status, body: errorBody(e.code, e.message, e.details, requestId) };
    }
    console.warn('[mock server] unexpected error', e);
    return { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong on our side.', {}, requestId) };
  }
}

/** Requests that the Demo panel's "inject on next request" applies to: real user writes. */
function isUserWrite(req: MockRequest): boolean {
  return req.method !== 'GET' && !req.path.startsWith('/auth') && !req.path.endsWith('/read');
}

export async function handle(req: MockRequest): Promise<MockResponse> {
  if (getNetwork().mode === 'offline') throw new NetworkFailure('offline');
  const requestId = req.headers['X-Request-Id'] ?? `req_${uuidv7()}`;
  const isUpload = req.method === 'PUT' && req.path.startsWith('/uploads/');
  const delay = latencyMs(isUpload);
  const inject = isUserWrite(req) ? takeInjection() : null;
  const flaky = inject === 'timeout_after_save' ? 'after' : rollFlakyTimeout();

  await sleep(delay * 0.6);
  if (getNetwork().mode === 'offline') throw new NetworkFailure('offline');
  if (flaky === 'before') {
    await sleep(TIMEOUT_MS - delay * 0.6);
    throw new NetworkFailure('timeout');
  }
  if (inject === '500') {
    return { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong on our side.', {}, requestId) };
  }
  if (inject === '403') {
    return { status: 403, body: errorBody('FORBIDDEN', "You don't have permission to do that.", {}, requestId) };
  }
  if (inject === '422') {
    return {
      status: 422,
      body: errorBody('VALIDATION_FAILED', 'Some fields need attention.', { fields: { _: 'Injected by the Demo panel' } }, requestId),
    };
  }
  const res = dispatch(req, requestId);
  if (flaky === 'after') {
    // The server saved the change, but the reply never reaches the client.
    await sleep(Math.max(0, TIMEOUT_MS - delay * 0.6));
    throw new NetworkFailure('timeout');
  }
  await sleep(delay * 0.4);
  if (getNetwork().mode === 'offline') throw new NetworkFailure('offline');
  // Responses cross a "wire": hand back copies so the app can never mutate server state.
  return { status: res.status, body: res.body === undefined ? null : JSON.parse(JSON.stringify(res.body)) };
}

/** Lets the bot and scripted teammates act as a user, without latency or injection. */
export function act(userId: ID, method: string, path: string, body?: unknown): MockResponse {
  const user = store().users.get(userId);
  if (!user) return { status: 404, body: null };
  return dispatch({ method, path, body, headers: {} }, `req_actor_${uuidv7()}`, user);
}

export function resetServer(): void {
  resetNotify();
  resetBot();
  resetNetwork();
  resetStore();
}
