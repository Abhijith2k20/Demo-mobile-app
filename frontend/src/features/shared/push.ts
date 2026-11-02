import { useEffect } from 'react';
import { listenForTaps, registerForPush } from '@/lib/push';
import { useSession } from '@/stores/session';

/** Once the signed-in tabs are showing (not on launch): ask for push and open tapped notifications. */
export function usePushSetup(): void {
  const companyId = useSession((s) => s.company?.id);
  useEffect(() => {
    if (!companyId) return;
    const timer = setTimeout(() => void registerForPush(), 1500); // after Home has been seen
    const stop = listenForTaps();
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [companyId]);
}
