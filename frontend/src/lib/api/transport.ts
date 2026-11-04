// The only place that knows where the backend is: HTTP via fetch, live events via WebSocket.
import Constants from 'expo-constants';
import type { ServerEvent } from '@/types/models';

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** multipart upload instead of JSON */
  form?: Upload;
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
/** Uploads get time for their size: the slowest connection still worth waiting for (about 64 kbit/s, weak 2G). */
const MIN_UPLOAD_BYTES_PER_SECOND = 8_000;
/** When the phone can't tell a file's size: as long as the largest file allowed (25 MB). */
const UNKNOWN_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A multipart upload and its size, so the time limit can grow with the file. */
export interface Upload {
  data: FormData;
  bytes: number;
}

function timeoutFor(req: TransportRequest): number {
  if (!req.form) return TIMEOUT_MS;
  return TIMEOUT_MS + ((req.form.bytes || UNKNOWN_UPLOAD_BYTES) / MIN_UPLOAD_BYTES_PER_SECOND) * 1000;
}

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
  const timer = setTimeout(() => controller.abort(), timeoutFor(req));
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
    let body: BodyInit | undefined;
    if (req.form) body = req.form.data;
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
  /** The server refused the token (it expired): get a fresh one before trying again. */
  onTokenRefused: () => Promise<unknown>,
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
    ws.onclose = (e) => {
      if (ping) clearInterval(ping);
      ping = null;
      ws = null;
      onStatus(false);
      // 4401: the access token expired (it lasts an hour). Retrying with it would fail forever.
      if (e.code === 4401) void onTokenRefused().catch(() => {}).finally(schedule);
      else schedule();
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
export function photoForm(uri: string, id: string, bytes: number): Upload {
  const name = uri.split('/').pop() || 'photo.jpg';
  const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
  return uploadForm(uri, 'image', name, type, id, bytes);
}

/**
 * A file for POST /uploads; `kind` sets the server's size limit and allowed types (it checks the content).
 * `id` is picked by the phone and kept with the queued item: sending it again returns the same upload.
 */
export function uploadForm(uri: string, kind: 'image' | 'voice' | 'file', name: string, type: string, id: string, bytes: number): Upload {
  const data = new FormData();
  // React Native's FormData takes a { uri, name, type } file descriptor.
  data.append('file', { uri, name, type } as unknown as Blob);
  data.append('kind', kind);
  data.append('id', id);
  return { data, bytes };
}
