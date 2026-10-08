// Rule 7 — what to do with a failure.
import type { AppError, ErrorKind } from '@/lib/api/client';

export type Verdict = 'offline' | 'temporary' | 'auth' | 'permanent';

const TEMPORARY: ErrorKind[] = ['timeout', 'server', 'rate_limited'];

export function classify(error: AppError): Verdict {
  if (error.kind === 'offline') return 'offline'; // stop the run; wait for the network
  if (error.kind === 'auth') return 'auth'; // the API client already tried one refresh
  if (TEMPORARY.includes(error.kind)) return 'temporary';
  return 'permanent'; // validation, forbidden, not_found, conflict
}

// Demo timings: 2 s, 5 s, 10 s, then every 20 s.
const STEPS = [2000, 5000, 10000];
const STEADY = 20000;

export function backoffMs(attempts: number): number {
  const base = STEPS[attempts - 1] ?? STEADY;
  return Math.round(base * (0.85 + Math.random() * 0.3)); // jitter
}
