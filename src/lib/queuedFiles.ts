// Photos waiting in the send queue live in the app's own folder, not the picker's cache (which
// the system may clear), so a photo taken in the field is still there when the signal comes back.
import { Directory, File, Paths } from 'expo-file-system';

const folder = () => new Directory(Paths.document, 'outbox');

/** Copies a picked photo into the app's folder and returns its new address (the original if copying fails). */
export function keepPhoto(uri: string, id: string): string {
  try {
    const dir = folder();
    dir.create({ idempotent: true, intermediates: true });
    const ext = /\.(\w{2,4})$/.exec(uri)?.[1] ?? 'jpg';
    const copy = new File(dir, `${id}.${ext}`);
    new File(uri).copySync(copy);
    return copy.uri;
  } catch (e) {
    console.warn('[outbox] could not keep photo', e);
    return uri;
  }
}

export function photoExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** Deletes a kept photo once it is uploaded or discarded. Photos outside the app's folder are left alone. */
export function dropPhoto(uri: string): void {
  try {
    if (!uri.startsWith(folder().uri)) return;
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch (e) {
    console.warn('[outbox] could not delete photo', e);
  }
}
