import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appScreen, Header, Screen } from '@/components/chrome';
import { MembersManager } from '@/features/members/MembersManager';
import { shortProjectName, useProject } from '@/features/shared';
import { space } from '@/theme/spacing';

/** Manage members (Managers). The same list also appears in the project's Members tab. */
function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const project = useProject(id);
  return (
    <Screen>
      <Header title="Members" subtitle={project ? shortProjectName(project.name) : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
        <MembersManager projectId={id} />
      </ScrollView>
    </Screen>
  );
}

export default appScreen(MembersScreen);
