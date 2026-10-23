import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import { useDmList, useUnreadActivityCount, useUnreadCounts } from '@/features/home/hooks';
import { isCompanyAdmin } from '@/shared/permissions';
import { useSession } from '@/stores/session';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

function TabsForUser() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const admin = !!user && isCompanyAdmin(user);
  const unread = useUnreadCounts();
  const dms = useDmList();
  const activity = useUnreadActivityCount();
  let allUnread = 0;
  for (const n of unread.values()) allUnread += n;
  // Direct messages have their own tab, so Home counts channels only.
  const totalUnread = allUnread - dms.totalUnread;
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
        // Like the system tab bars: labels grow a little, not to 200%, so five tabs still fit.
        tabBarAllowFontScaling: false,
        tabBarBadgeStyle: badgeStyle,
        sceneStyle: { backgroundColor: c.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home', 'Home'),
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
          tabBarBadge: count(totalUnread),
        }}
      />
      <Tabs.Screen
        name="dms"
        options={{
          title: t('tabs.dms', 'DMs'),
          tabBarIcon: ({ color }) => <Feather name="message-circle" size={22} color={color} />,
          tabBarBadge: count(dms.totalUnread),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          // Owner/Admin get the company Dashboard in place of the Tasks tab.
          title: admin ? t('tabs.dashboard', 'Dashboard') : t('tabs.tasks', 'Tasks'),
          tabBarIcon: ({ color }) => <Feather name={admin ? 'bar-chart-2' : 'check-square'} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity', 'Activity'),
          tabBarIcon: ({ color }) => <Feather name="bell" size={22} color={color} />,
          tabBarBadge: count(activity),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t('tabs.you', 'You'),
          tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
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
