// Running a write against the server: refresh what changed on success, explain a refusal.
// (Site actions that must survive no signal go through the send queue instead: lib/outbox.ts.)
import type { QueryKey } from '@tanstack/react-query';
import { isAppError, type AppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { refresh } from '@/lib/queries';
import { toast } from '@/stores/ui';

/**
 * Runs a write. On success the listed data is fetched again; on failure the reason is shown
 * and null is returned, so callers can fire and forget without unhandled rejections.
 */
export async function attempt<T>(fn: () => Promise<T>, invalidate: QueryKey[] = []): Promise<T | null> {
  try {
    const result = await fn();
    void refresh(...invalidate);
    return result;
  } catch (e) {
    toast(errorText(isAppError(e) ? e : 'UNKNOWN'), 'danger');
    return null;
  }
}

/** Like `attempt`, for forms: returns the error so field messages can be shown next to inputs. */
export async function submit<T>(fn: () => Promise<T>, invalidate: QueryKey[] = []): Promise<{ data: T } | { error: AppError }> {
  try {
    const data = await fn();
    void refresh(...invalidate);
    return { data };
  } catch (e) {
    if (isAppError(e)) return { error: e };
    toast(errorText('UNKNOWN'), 'danger');
    throw e;
  }
}

/**
 * Turns a refused form into messages under the fields. Errors that aren't about a field
 * (no permission, no connection) are shown as a toast instead.
 */
export function fieldErrors(error: AppError): Record<string, string> {
  const fields = error.details.fields ?? {};
  if (Object.keys(fields).length === 0) toast(errorText(error), 'danger');
  return fields;
}
