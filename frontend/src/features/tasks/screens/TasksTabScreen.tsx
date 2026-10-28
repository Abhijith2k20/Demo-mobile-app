import { appScreen, Screen } from '@/components/chrome';
import { MyTasks } from '@/features/tasks/components/MyTasks';

/** "My tasks": the tasks assigned to the signed-in person, for every role. */
function TasksTab() {
  return (
    <Screen>
      <MyTasks />
    </Screen>
  );
}

export default appScreen(TasksTab);
