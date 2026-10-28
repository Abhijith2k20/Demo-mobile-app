import { create } from 'zustand';

export interface ApiLogEntry {
  id: number;
  method: string;
  path: string;
  status: number | 'offline' | 'timeout';
  ms: number;
  requestId: string;
  code?: string;
}
export interface EventLogEntry {
  id: number;
  type: string;
  summary: string;
  at: number;
}

interface DemoState {
  apiLog: ApiLogEntry[];
  eventLog: EventLogEntry[];
  logApi: (e: Omit<ApiLogEntry, 'id'>) => void;
  logEvent: (type: string, summary: string) => void;
  clearLogs: () => void;
}

const MAX = 30;
let seq = 0;

export const useDemo = create<DemoState>((set) => ({
  apiLog: [],
  eventLog: [],
  logApi: (e) => set((s) => ({ apiLog: [{ ...e, id: ++seq }, ...s.apiLog].slice(0, MAX) })),
  logEvent: (type, summary) =>
    set((s) => ({ eventLog: [{ id: ++seq, type, summary, at: Date.now() }, ...s.eventLog].slice(0, MAX) })),
  clearLogs: () => set({ apiLog: [], eventLog: [] }),
}));
