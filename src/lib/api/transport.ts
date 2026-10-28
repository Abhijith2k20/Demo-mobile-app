// The only place that knows where the backend is: HTTP via fetch, live events via WebSocket.
import Constants from 'expo-constants';
import type { ServerEvent } from '@/types/models';

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** multipart upload instead of JSON */
  form?: FormData;
  headers: Record<string, string>;
}
export interface TransportResponse {
  status: number;
  body: unknown;
}
export class TransportError extends Error {
  kind: 'offline' | 'timeout';
  constructor(kind: 'offline' | 'timeout') {
    super(kind);
    this.kind = kind;
  }
}

/**
 * The FastAPI server: EXPO_PUBLIC_API_URL if set, otherwise the machine running Expo, port 8000.
 * On the Android emulator that is 127.0.0.1 (run `adb reverse tcp:8000 tcp:8000`); on a phone on
 * the same Wi-Fi it is the laptop's address.
 */
function baseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? '127.0.0.1';
  return `http://${host}:8000`;
}
export const API_URL = baseUrl();

const TIMEOUT_MS = 12_000;

/** Demo panel switch: behave as if the phone had no signal. */
let simulatedOffline = false;
const offlineListeners = new Set<(offline: boolean) => void>();
export function setSimulatedOffline(value: boolean): void {
  simulatedOffline = value;
  for (const fn of offlineListeners) fn(value);
}
export const isSimulatedOffline = (): boolean => simulatedOffline;

export async function request(req: TransportRequest): Promise<TransportResponse> {
  if (simulatedOffline) throw new TransportError('offline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
    let body: BodyInit | undefined;
    if (req.form) body = req.form;
    else if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    const res = await fetch(`${API_URL}${req.path}`, { method: req.method, headers, body, signal: controller.signal });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch (e) {
    if (controller.signal.aborted) throw new TransportError('timeout');
    if (e instanceof TransportError) throw e;
    throw new TransportError('offline'); // fetch only throws when the server can't be reached
  } finally {
    clearTimeout(timer);
  }
}

/** Live events for the signed-in user. Reconnects with backoff; returns a function that closes it. */
export function openEventStream(
  getToken: () => string | null,
  onEvent: (e: ServerEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const schedule = () => {
    if (closed) return;
    const wait = Math.min(15_000, 1000 * 2 ** attempt++);
    retry = setTimeout(connect, wait);
  };

  function connect() {
    retry = null;
    const token = getToken();
    if (closed || !token || simulatedOffline) return schedule();
    ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      attempt = 0;
      onStatus(true);
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as ServerEvent);
      } catch (e) {
        console.warn('[events] bad frame', e);
      }
    };
    ws.onclose = () => {
      if (ping) clearInterval(ping);
      ping = null;
      ws = null;
      onStatus(false);
      schedule();
    };
    ws.onerror = () => ws?.close();
  }

  const offOffline = (offline: boolean) => {
    if (offline) ws?.close();
    else if (!ws && !retry) connect();
  };
  offlineListeners.add(offOffline);
  connect();
  return () => {
    closed = true;
    offlineListeners.delete(offOffline);
    if (retry) clearTimeout(retry);
    if (ping) clearInterval(ping);
    ws?.close();
  };
}

/** A photo on the phone becomes a file on the server. */
export function photoForm(uri: string): FormData {
  const name = uri.split('/').pop() || 'photo.jpg';
  const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
  const form = new FormData();
  // React Native's FormData takes a { uri, name, type } file descriptor.
  form.append('file', { uri, name, type } as unknown as Blob);
  return form;
}
