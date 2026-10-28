import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get, keys } from '@/lib/queries';
import type { DemoAccount } from '@/types/models';
import { useRoleLabels } from '../shared';

export interface DemoUser {
  email: string;
  name: string;
  /** Job title, or Owner / Admin. */
  subtitle: string;
}

/** Demo build: one sign-in per role, from the server (shown on the login screen and in the Demo panel). */
export function useDemoAccounts(): DemoUser[] {
  const q = useQuery({ queryKey: keys.demoAccounts, queryFn: get<{ accounts: DemoAccount[] }>('/auth/demo-accounts') });
  const labels = useRoleLabels();
  return useMemo(
    () => (q.data?.accounts ?? []).map((a) => ({ email: a.email, name: a.name, subtitle: a.jobTitle ?? labels.company(a.companyRole) })),
    [q.data, labels],
  );
}
