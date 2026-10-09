import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, Skeleton } from '@/components/basics';
import { appScreen, OfflineBanner, Screen } from '@/components/chrome';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { useAllProjectMembers, useMe, useProjects, useUnsentCount } from '@/features/shared';
import { MyTasks } from '@/features/tasks/components/MyTasks';
import { ProjectSwitcher } from '@/features/tasks/components/ProjectSwitcher';
import { ScheduleList } from '@/features/tasks/components/ScheduleList';
import { isCompanyAdmin } from '@/shared/permissions';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID } from '@/types/models';

/**
 * Role-aware tab:
 *  - Owner/Admin → company Dashboard
 *  - Manager of at least one project → schedule list with a project switcher
 *  - everyone else → "My tasks"
 */
function TasksTab() {
  const me = useMe();
  const memberships = useAllProjectMembers();
  if (isCompanyAdmin(me)) {
    return (
      <Screen>
        <Dashboard embedded />
      </Screen>
    );
  }
  const managesSomething = memberships.some((m) => m.userId === me.id && m.role === 'manager');
  return <Screen>{managesSomething ? <ManagerSchedule /> : <MyTasks />}</Screen>;
}

function ManagerSchedule() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const projects = useProjects();
  const memberships = useAllProjectMembers();
  const unsent = useUnsentCount();
  const [picked, setPicked] = useState<ID | null>(null);
  // Projects the user manages come first; that is where they do schedule work.
  const ordered = useMemo(() => {
    const managed = new Set(memberships.filter((m) => m.userId === me.id && m.role === 'manager').map((m) => m.projectId));
    return [...projects.list].sort(
      (a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || Number(managed.has(b.id)) - Number(managed.has(a.id)),
    );
  }, [projects.list, memberships, me.id]);
  const current = ordered.find((p) => p.id === picked) ?? ordered[0];

  if (projects.loading) return <Skeleton rows={8} avatar={false} />;
  if (!current) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState icon="folder" title="No projects yet" hint="Projects you belong to will show their schedule here." />
      </View>
    );
  }
  return (
    <ScheduleList
      project={current}
      header={
        <View style={{ backgroundColor: c.surface, paddingTop: insets.top + space.sm, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <ProjectSwitcher projects={ordered} current={current} onPick={setPicked} />
          <OfflineBanner waiting={unsent.waiting} />
        </View>
      }
    />
  );
}

export default appScreen(TasksTab);
