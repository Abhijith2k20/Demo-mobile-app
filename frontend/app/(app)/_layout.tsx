import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import type { IconName } from '@/components/basics';
import { useUnreadActivityCount } from '@/features/activity/hooks';
import { useMeSync, useTabUnread } from '@/features/shared';
import { usePushSetup } from '@/features/shared/push';
import { useSession } from '@/stores/session';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

// The tab bar always passes a colour string; React Native 0.88 types it as any colour value, so narrow it for Feather.
function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Feather name={name} size={22} color={typeof color === 'string' ? color : undefined} />;
  };
}

function TabsForUser() {
  const { c } = useTheme();
  const { t } = useTranslation();
  useMeSync();
  usePushSetup();
  // Home counts channels, DMs counts direct messages and the bot; muted conversations count in neither.
  const unread = useTabUnread();
  const activity = useUnreadActivityCount();
  const count = (n: number) => (n > 0 ? (n > 99 ? '99+' : n) : undefined);
  const badgeStyle = { backgroundColor: c.accent, color: c.onAccent, fontFamily: fonts.semibold, fontSize: 11 };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: 1, elevation: 0 },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        // Like the system tab bars: labels grow a little, not to 200%, so the tabs still fit.
        tabBarAllowFontScaling: false,
        tabBarBadgeStyle: badgeStyle,
        sceneStyle: { backgroundColor: c.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home', 'Home'),
          tabBarIcon: tabIcon('home'),
          tabBarBadge: count(unread.channels),
        }}
      />
      <Tabs.Screen
        name="dms"
        options={{
          title: t('tabs.dms', 'DMs'),
          tabBarIcon: tabIcon('message-circle'),
          tabBarBadge: count(unread.dms),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity', 'Activity'),
          tabBarIcon: tabIcon('bell'),
          tabBarBadge: count(activity),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t('tabs.you', 'You'),
          tabBarIcon: tabIcon('user'),
        }}
      />
    </Tabs>
  );
}

export default function AppLayout() {
  const user = useSession((s) => s.user);
  // The root auth gate redirects; render nothing while signed out so no tab queries run.
  if (!user) return null;
  return <TabsForUser />;
}
