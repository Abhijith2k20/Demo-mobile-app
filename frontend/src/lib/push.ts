// Push notifications (spec §12.6): asked for once Home has been seen, token sent to the server, and a tapped
// notification opens its screen. Needs a development or store build (remote push isn't in Expo Go).
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from '@/lib/api/client';

type NotificationsModule = typeof import('expo-notifications');

/** Expo Go has no push module at all, so it is loaded only in real builds (quick checks in Expo Go still work). */
const Notifications: NotificationsModule | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loading it in Expo Go crashes the app
  Constants.appOwnership === 'expo' ? null : (require('expo-notifications') as NotificationsModule);

Notifications?.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let registered: string | null = null;

/** Asks for permission (once) and registers this phone's push token. Quietly does nothing where push can't work. */
export async function registerForPush(): Promise<void> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!Notifications || !Device.isDevice || !projectId) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Siteline', importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('PUT', '/me/push-tokens', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    registered = token;
  } catch (e) {
    console.warn('[push] not registered', e); // offline or no permission: tried again next start
  }
}

/** At log out: this phone stops getting this person's pushes. */
export async function forgetPushToken(): Promise<void> {
  if (!registered) return;
  await api('DELETE', `/me/push-tokens/${encodeURIComponent(registered)}`).catch(() => {});
  registered = null;
}

/** Opens the screen a tapped notification points to (its data.url, e.g. /channel/123 or /dm/bot). */
export function listenForTaps(): () => void {
  if (!Notifications) return () => {};
  const open = (response: import('expo-notifications').NotificationResponse | null) => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
  };
  void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
