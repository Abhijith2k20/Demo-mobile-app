// Invite someone by work email or phone (spec §5.11). Guests get only the channels picked here.
import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Button, Segmented } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { inviteSchema, type InviteInput } from '@/contract/schemas';
import { invitePerson } from '../api';
import { fieldErrors } from '@/lib/mutations';
import { shortProjectName, useCan, useChannels, useProjects } from '@/features/shared';
import { toast } from '@/stores/ui';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

type Role = InviteInput['role'];

export function InviteSheet({ visible, onClose, initial }: { visible: boolean; onClose: () => void; initial?: string }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const can = useCan();
  const channels = useChannels();
  const projects = useProjects();
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState(initial ?? '');
  const [role, setRole] = useState<Role>('member');
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const projectChannels = useMemo(
    () => channels.list.filter((ch) => ch.kind === 'project' && ch.projectId && !projects.byId.get(ch.projectId)?.archivedAt),
    [channels.list, projects.byId],
  );

  const close = () => {
    setName('');
    setIdentifier('');
    setRole('member');
    setPicked([]);
    setErrors({});
    onClose();
  };

  const submit = async () => {
    const parsed = inviteSchema.safeParse({ name, identifier, role, channelIds: role === 'guest' ? picked : [] });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    if (role === 'guest' && picked.length === 0) {
      setErrors({ channelIds: t('invite.pickChannel', 'Pick at least one channel for a guest.') });
      return;
    }
    setSaving(true);
    const res = await invitePerson(parsed.data);
    setSaving(false);
    if ('error' in res) {
      setErrors(fieldErrors(res.error));
      return;
    }
    toast(t('invite.sent', 'Invite sent to {{who}}.', { who: res.data.identifier }));
    close();
  };

  const roles: { value: Role; label: string }[] = [
    { value: 'member', label: t('you.member', 'Member') },
    { value: 'guest', label: t('you.guest', 'Guest') },
    ...(can('user.invite_admin') ? [{ value: 'admin' as Role, label: t('you.admin', 'Admin') }] : []),
  ];

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={t('invite.title', 'Invite person')}
      subtitle={t('invite.hint', 'They get an email or SMS, and join by signing in with that address.')}
      full>
      <Field label={t('invite.name', 'Name')} error={errors.name}>
        <SheetInput value={name} onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: '' })); }} placeholder="Deepa Nair" autoCapitalize="words" />
      </Field>
      <Field label={t('invite.identifier', 'Work email or phone number')} error={errors.identifier}>
        <SheetInput
          value={identifier}
          onChangeText={(v) => {
            setIdentifier(v);
            setErrors((e) => ({ ...e, identifier: '' }));
          }}
          placeholder={t('auth.identifierPlaceholder', 'name@company.com or 98765 43210')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </Field>
      <Field label={t('invite.role', 'Company role')}>
        <Segmented<Role> value={role} onChange={setRole} options={roles} />
        <T variant="meta" color="textMuted" style={{ marginTop: space.xs }}>
          {role === 'admin'
            ? t('invite.adminHint', 'Admins see every project and can invite people.')
            : role === 'guest'
              ? t('invite.guestHint', 'Guests (clients, architects, subcontractors) see only the channels you pick.')
              : t('invite.memberHint', 'Members see the projects they are on, and the company channels.')}
        </T>
      </Field>
      {role === 'guest' ? (
        <Field label={t('invite.channels', 'Channels')} error={errors.channelIds}>
          <View style={{ gap: 2 }}>
            {projectChannels.map((ch) => {
              const on = picked.includes(ch.id);
              return (
                <Pressable
                  key={ch.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setPicked((p) => (on ? p.filter((x) => x !== ch.id) : [...p, ch.id]))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
                  <Feather name={on ? 'check-square' : 'square'} size={20} color={on ? c.accent : c.textMuted} />
                  <T variant="body" style={{ flex: 1 }} numberOfLines={1}>
                    {shortProjectName(projects.byId.get(ch.projectId!)?.name ?? '')} · #{ch.name}
                  </T>
                </Pressable>
              );
            })}
          </View>
        </Field>
      ) : null}
      <Button label={t('invite.send', 'Send invite')} loading={saving} onPress={() => void submit()} />
    </Sheet>
  );
}
