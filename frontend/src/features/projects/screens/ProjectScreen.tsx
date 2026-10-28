import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, EmptyState, IconButton, Segmented } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { MembersManager } from '@/features/projects/components/MembersManager';
import { useProject, useProjectAccess } from '@/features/shared';
import { ScheduleList } from '@/features/tasks/components/ScheduleList';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { ProjectFiles } from '@/features/projects/components/ProjectFiles';
import { ProjectOverview } from '@/features/projects/components/ProjectOverview';

type Tab = 'overview' | 'tasks' | 'members' | 'files';

function ProjectScreen({ projectId: id }: { projectId: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const project = useProject(id);
  const access = useProjectAccess(id);
  const canManage = access.canArchive || access.isAdmin || access.can('channel.manage') || access.can('project.members');
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <Screen>
      <Header
        title={project ? project.name.split(' – ')[0] : 'Project'}
        subtitle={project?.name.split(' – ')[1]}
        right={
          project && canManage ? (
            <IconButton icon="settings" label="Project settings" onPress={() => router.push(`/project/${project.id}/settings`)} />
          ) : undefined
        }
      />
      <OfflineBanner />
      {project?.archivedAt ? <Banner icon="archive" text="This project is archived. It is read-only." /> : null}
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'tasks', label: 'Tasks' },
            { value: 'members', label: 'Members' },
            { value: 'files', label: 'Files' },
          ]}
        />
      </View>
      {!project ? (
        <EmptyState icon="folder" title="This project isn't available" hint="You may no longer have access to it." />
      ) : tab === 'overview' ? (
        <ProjectOverview project={project} />
      ) : tab === 'tasks' ? (
        <ScheduleList project={project} />
      ) : tab === 'members' ? (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
          <MembersManager projectId={project.id} />
        </ScrollView>
      ) : (
        <ProjectFiles projectId={project.id} />
      )}
    </Screen>
  );
}

export default appScreen(ProjectScreen);
