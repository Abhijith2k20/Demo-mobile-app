import { runOutboxNow } from '@/lib/outbox/runner';
import { endSession } from '@/lib/session';
import i18n from '@/lib/i18n';
import { toast, useUi } from '@/stores/ui';

/** Ends the session and wipes local data. Unsent changes are lost (the UI warns first). */
export function logOut(): void {
  endSession();
}

export function sendNow(): void {
  if (!useUi.getState().online) {
    toast(i18n.t('offline.banner', "You're offline. Changes will send automatically."));
    return;
  }
  runOutboxNow();
  toast(i18n.t('you.sendingNow', 'Sending now…'));
}
