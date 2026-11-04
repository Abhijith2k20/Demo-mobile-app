import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get, keys } from '@/lib/queries';
import type { DemoAccount } from '@/types/models';
import { useRoleLabels } from '../shared';

interface DemoUser {
  identifier: string;
  company: string;
  name: string;
  /** Their role and company. */
  subtitle: string;
}

/** Development and staging builds: one sign-in per role in each seeded company (sign-in sheet and dev panel). */
export function useDemoAccounts(): DemoUser[] {
  const q = useQuery({ queryKey: keys.demoAccounts, queryFn: get<{ accounts: DemoAccount[] }>('/auth/demo-accounts'), retry: false });
  const labels = useRoleLabels();
  return useMemo(
    () =>
      (q.data?.accounts ?? []).map((a) => ({
        identifier: a.identifier,
        company: a.company,
        name: a.name,
        subtitle: `${labels.company(a.companyRole)} · ${a.company}`,
      })),
    [q.data, labels],
  );
}
