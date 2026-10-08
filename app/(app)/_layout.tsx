import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import { useUnreadActivityCount, useUnreadCounts } from '@/features/home/hooks';
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
  const activity = useUnreadActivityCount();
  let totalUnread = 0;
  for (const n of unread.values()) totalUnread += n;
  const badgeStyle = { backgroundColor: c.accent, color: c.onAccent, fontFamily: fonts.semibold, fontSize: 11 };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: 1, elevation: 0 },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarBadgeStyle: badgeStyle,
        sceneStyle: { backgroundColor: c.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home', 'Home'),
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
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
          tabBarBadge: activity > 0 ? (activity > 99 ? '99+' : activity) : undefined,
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
