// Names and labels for showing things (no rules).
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompanyRole, User } from '@/types/models';

export const firstName = (name: string | undefined): string => name?.split(' ')[0] ?? '';

export const shortProjectName = (name: string): string => name.split(' – ')[0];

/** Names for company roles. */
export function useRoleLabels() {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      company: (role: CompanyRole) =>
        role === 'owner'
          ? t('you.owner', 'Owner')
          : role === 'admin'
            ? t('you.admin', 'Admin')
            : role === 'guest'
              ? t('you.guest', 'Guest')
              : t('you.member', 'Member'),
    }),
    [t],
  );
}

export const BOT_EMAIL = 'bot@siteline.app';

export const isBotUser = (u: User | undefined): boolean => u?.email === BOT_EMAIL;
