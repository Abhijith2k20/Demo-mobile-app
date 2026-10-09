import { useLocalSearchParams } from 'expo-router';
import ProjectScreen from '@/features/projects/screens/ProjectScreen';

// Route only: reads the URL parameters and renders the screen from src/features/projects/screens/ProjectScreen.tsx
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProjectScreen projectId={id} />;
}
