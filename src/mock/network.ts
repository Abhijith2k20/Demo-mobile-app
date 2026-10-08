// Network conditions + error injection, driven from the Demo panel (§10.5).
import { setConnected } from './events';

export type NetworkMode = 'online' | 'slow' | 'flaky' | 'offline';
export type Injection = '500' | '403' | '422' | 'timeout_after_save';

export const TIMEOUT_MS = 8000;

interface NetworkState {
  mode: NetworkMode;
  inject: Injection | null;
}

const state: NetworkState = { mode: 'online', inject: null };
const listeners = new Set<(s: NetworkState) => void>();

function emit(): void {
  for (const fn of listeners) fn({ ...state });
}

export function getNetwork(): NetworkState {
  return { ...state };
}

export function setMode(mode: NetworkMode): void {
  state.mode = mode;
  setConnected(mode !== 'offline');
  emit();
}

export function setInjection(inject: Injection | null): void {
  state.inject = inject;
  emit();
}

/** Takes the pending injection (if any) so it applies to exactly one request. */
export function takeInjection(): Injection | null {
  const i = state.inject;
  if (i) {
    state.inject = null;
    emit();
  }
  return i;
}

export function onNetworkChange(fn: (s: NetworkState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function latencyMs(upload: boolean): number {
  if (upload) return state.mode === 'slow' ? rand(3000, 5000) : rand(1000, 4000);
  return state.mode === 'slow' ? rand(2000, 4000) : rand(250, 900);
}

export function rollFlakyTimeout(): 'before' | 'after' | null {
  if (state.mode !== 'flaky' || Math.random() >= 0.3) return null;
  return Math.random() < 0.5 ? 'before' : 'after';
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function resetNetwork(): void {
  state.mode = 'online';
  state.inject = null;
  setConnected(true);
  emit();
}
