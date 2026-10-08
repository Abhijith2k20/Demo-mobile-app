// The ONLY place (besides the Demo panel) that knows about the mock server.
// To point the app at the real backend, reimplement these four functions with
// fetch + WebSocket + NetInfo; nothing else in the app needs to change.
import { startActors } from '@/mock/actors';
import * as mockEvents from '@/mock/events';
import { getNetwork, onNetworkChange } from '@/mock/network';
import { handle, NetworkFailure } from '@/mock/server';
import type { ID, ServerEvent } from '@/types/models';

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
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

startActors();

export async function request(req: TransportRequest): Promise<TransportResponse> {
  try {
    // Bodies cross a "wire": serialise so the server never shares objects with the app.
    const body = req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body));
    return await handle({ ...req, body });
  } catch (e) {
    if (e instanceof NetworkFailure) throw new TransportError(e.kind);
    throw e;
  }
}

/** Stand-in for the WebSocket. Returns a function that closes the stream. */
export function openEventStream(
  userId: ID,
  onEvent: (e: ServerEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const offEvents = mockEvents.subscribe(userId, onEvent);
  const offStatus = mockEvents.onStatus(onStatus);
  onStatus(mockEvents.isConnected());
  return () => {
    offEvents();
    offStatus();
  };
}

/** Stand-in for NetInfo. */
export function isOnline(): boolean {
  return getNetwork().mode !== 'offline';
}

export function onConnectivity(fn: (online: boolean) => void): () => void {
  let last = isOnline();
  return onNetworkChange((s) => {
    const online = s.mode !== 'offline';
    if (online !== last) {
      last = online;
      fn(online);
    }
  });
}
