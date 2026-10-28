import { useEffect } from 'react';
import { api } from '@/lib/api/client';

/**
 * When the bot conversation opens, ask the server to check in on every open task the user owns.
 * The cards arrive as live events. Offline, nothing happens; the next open tries again.
 */
export function useAskOnOpen(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    api('POST', '/bot/checkins').catch(() => {});
  }, [enabled]);
}
