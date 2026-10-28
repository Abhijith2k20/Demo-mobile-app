// Names and labels for showing things (no rules).
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { OTHER_PROBLEM } from '@/contract/schemas';
import type { CompanyRole, JobTitle, ProjectRole, Stage, User } from '@/types/models';
import { useMeta } from './data';

export const firstName = (name: string | undefined): string => name?.split(' ')[0] ?? '';

export const shortProjectName = (name: string): string => name.split(' – ')[0];

/** The company's stages (from its setup on the server), in order, with labels in the user's language. */
export function useStages() {
  const stages = useMeta()?.stages;
  return useMemo(() => {
    const list = stages ?? [];
    const index = (key: Stage) => list.findIndex((st) => st.key === key);
    return { list, index, label: (key: Stage) => list[index(key)]?.label ?? key };
  }, [stages]);
}

/** Names for company roles, project roles and the company's own job titles, in the user's language. */
export function useRoleLabels() {
  const { t } = useTranslation();
  const jobTitles = useMeta()?.jobTitles;
  return useMemo(
    () => ({
      company: (role: CompanyRole) =>
        role === 'owner' ? t('you.owner', 'Owner') : role === 'admin' ? t('you.admin', 'Admin') : t('you.member', 'Member'),
      project: (role: ProjectRole) => (role === 'manager' ? t('you.manager', 'Manager') : t('you.member', 'Member')),
      jobTitle: (name: JobTitle) => jobTitles?.find((jt) => jt.name === name)?.label ?? name,
    }),
    [t, jobTitles],
  );
}

/** The company's problem types plus "Other", and a label for any saved reason. */
export function useProblemTypes() {
  const { t } = useTranslation();
  const types = useMeta()?.problemTypes;
  return useMemo(() => {
    const other = { key: OTHER_PROBLEM, label: t('issue.other', 'Other'), inCheckins: true };
    const all = [...(types ?? []), other];
    return {
      all,
      forCheckins: all.filter((p) => p.inCheckins),
      label: (key: string) => all.find((p) => p.key === key)?.label ?? key,
    };
  }, [t, types]);
}

export const BOT_EMAIL = 'bot@siteline.app';

export const isBotUser = (u: User | undefined): boolean => u?.email === BOT_EMAIL;
