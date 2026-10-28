import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Segmented } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { invitePerson } from '../api';
import { fieldErrors } from '@/lib/mutations';
import { useCan } from '@/features/shared';
import { userInviteSchema } from '@/contract/schemas';
import { toast } from '@/stores/ui';
import { space } from '@/theme/spacing';
import type { User } from '@/types/models';

type Role = 'member' | 'admin';

export function InviteSheet({ me, visible, onClose }: { me: User; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const can = useCan();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const close = () => {
    setName('');
    setEmail('');
    setRole('member');
    setErrors({});
    onClose();
  };

  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const parsed = userInviteSchema.omit({ id: true }).safeParse({ name, email, companyRole: role });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setSaving(true);
    const res = await invitePerson(parsed.data);
    setSaving(false);
    if ('error' in res) {
      // The server checks the email and the role; show its answer under the right field.
      setErrors(res.error.code === 'EMAIL_TAKEN' ? { email: t('errors.EMAIL_TAKEN', 'Someone already uses this email.') } : fieldErrors(res.error));
      return;
    }
    toast(t('invite.done', '{{name}} can now sign in with {{email}}.', { name: res.data.name, email: res.data.email }));
    close();
  };

  return (
    <Sheet visible={visible} onClose={close} title={t('invite.title', 'Invite person')} subtitle={t('invite.hint', 'They sign in with this work email and a 6-digit code.')} full>
      <Field label={t('invite.name', 'Name')} error={errors.name}>
        <SheetInput value={name} onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: '' })); }} placeholder="Deepa Nair" autoCapitalize="words" />
      </Field>
      <Field label={t('invite.email', 'Work email')} error={errors.email}>
        <SheetInput
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setErrors((e) => ({ ...e, email: '' }));
          }}
          placeholder="name@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </Field>
      {can('user.invite_admin') ? (
        <Field label={t('invite.role', 'Company role')}>
          <Segmented<Role>
            value={role}
            onChange={setRole}
            options={[
              { value: 'member', label: t('you.member', 'Member') },
              { value: 'admin', label: t('you.admin', 'Admin') },
            ]}
          />
          <T variant="meta" color="textMuted" style={{ marginTop: space.xs }}>
            {role === 'admin'
              ? t('invite.adminHint', 'Admins see every project and can invite people.')
              : t('invite.memberHint', 'Members see only the projects they are added to.')}
          </T>
        </Field>
      ) : null}
      <Button label={t('invite.send', 'Invite')} loading={saving} onPress={() => void submit()} />
    </Sheet>
  );
}
