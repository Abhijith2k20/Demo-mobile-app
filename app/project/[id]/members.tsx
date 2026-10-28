import { useLocalSearchParams } from 'expo-router';
import MembersScreen from '@/features/projects/screens/MembersScreen';

// Route only: reads the URL parameters and renders the screen from src/features/projects/screens/MembersScreen.tsx
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MembersScreen projectId={id} />;
}
