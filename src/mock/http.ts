// Small routing + error helpers shared by the mock route files.
import type { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from '@/shared/errorCodes';
import type { StoredUser } from './db';

export class MockError extends Error {
  status: number;
  code: ErrorCode;
  details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new MockError('NOT_FOUND', `${what} not found.`);
export const forbidden = (message = "You don't have permission to do that.") => new MockError('FORBIDDEN', message);

export interface Ctx {
  /** Authenticated user. On public routes this is a placeholder and must not be read. */
  user: StoredUser;
  params: Record<string, string>;
  query: Record<string, string>;
  // The mock-server boundary: bodies arrive untyped and are parsed with zod in each route.
  body: unknown;
}

export interface RouteDef {
  method: string;
  parts: string[];
  isPublic: boolean;
  handler: (ctx: Ctx) => unknown;
}

export function route(method: string, path: string, handler: (ctx: Ctx) => unknown, isPublic = false): RouteDef {
  return { method, parts: path.split('/').filter(Boolean), isPublic, handler };
}

export function matchRoute(def: RouteDef, method: string, parts: string[]): Record<string, string> | null {
  if (def.method !== method || def.parts.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = def.parts[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}

/** Validates with zod; failures become 422 VALIDATION_FAILED with `details.fields`. */
export function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const res = schema.safeParse(body ?? {});
  if (res.success) return res.data;
  const fields: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new MockError('VALIDATION_FAILED', 'Some fields need attention.', { fields });
}
