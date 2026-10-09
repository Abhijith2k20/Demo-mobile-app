import { View } from 'react-native';
import { EmptyState } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { useMe } from '@/features/shared';
import { isCompanyAdmin } from '@/shared/permissions';

/** Company dashboard (Owner/Admin). Also shown in place of the Tasks tab for them. */
function DashboardScreen() {
  const me = useMe();
  return (
    <Screen>
      <Header title="Dashboard" subtitle="Paliath Interiors" />
      {isCompanyAdmin(me) ? (
        <Dashboard />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState icon="lock" title="The dashboard is for the owner and admins" />
        </View>
      )}
    </Screen>
  );
}

export default appScreen(DashboardScreen);
