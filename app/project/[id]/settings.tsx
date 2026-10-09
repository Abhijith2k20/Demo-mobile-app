import { useLocalSearchParams } from 'expo-router';
import ProjectSettingsScreen from '@/features/projects/screens/ProjectSettingsScreen';

// Route only: reads the URL parameters and renders the screen from src/features/projects/screens/ProjectSettingsScreen.tsx
export default function Route() {
  const { channel, id } = useLocalSearchParams<{ channel?: string; id: string }>();
  return <ProjectSettingsScreen projectId={id} openChannelId={channel} />;
}
