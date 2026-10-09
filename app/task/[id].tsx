import { useLocalSearchParams } from 'expo-router';
import TaskDetailScreen from '@/features/tasks/screens/TaskDetailScreen';

// Route only: reads the URL parameters and renders the screen from src/features/tasks/screens/TaskDetailScreen.tsx
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaskDetailScreen taskId={id} />;
}
