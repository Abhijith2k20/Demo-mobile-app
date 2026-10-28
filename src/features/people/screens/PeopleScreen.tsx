import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, EmptyState, Pill } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { Input } from '@/components/form';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { deactivatePerson } from '../api';
import { InviteSheet } from '../components/InviteSheet';
import { firstName, isBotUser, shortProjectName, useAllProjectMembers, useCan, useMe, useProjects, useRoleLabels, useUsers } from '@/features/shared';
import { toast } from '@/stores/ui';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { User, UserView } from '@/types/models';

/** Everyone in the company. Owner and Admins can also invite and deactivate people here. */
function PeopleScreen() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const can = useCan();
  const users = useUsers();
  const projects = useProjects();
  const members = useAllProjectMembers();
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<UserView | null>(null);
  const [confirming, setConfirming] = useState<UserView | null>(null);
  // Keep showing the last person while their sheet animates out.
  const [shown, setShown] = useState<UserView | null>(null);
  if (open && open !== shown) setShown(open);
  const person = open ?? shown;

  const labels = useRoleLabels();
  const roleLabel = (u: Pick<User, 'companyRole'>) => labels.company(u.companyRole);

  const { active, inactive } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const people = users.list.filter((u) => !isBotUser(u) && (u.name.toLowerCase().includes(q) || u.email.includes(q)));
    return { active: people.filter((u) => u.isActive), inactive: people.filter((u) => !u.isActive) };
  }, [users.list, query]);

  const personProjects = useMemo(
    () => (person ? members.filter((m) => m.userId === person.id).map((m) => ({ m, p: projects.byId.get(m.projectId) })).filter((x) => x.p) : []),
    [person, members, projects.byId],
  );

  const row = (u: UserView) => (
    <Pressable
      key={u.id}
      accessibilityRole="button"
      accessibilityLabel={`${u.name}, ${roleLabel(u)}, ${u.email}${u.isActive ? '' : `, ${t('people.deactivated', 'Deactivated')}`}`}
      onPress={() => setOpen(u)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        minHeight: 56,
        opacity: u.isActive ? 1 : 0.6,
        backgroundColor: pressed ? c.surfaceAlt : 'transparent',
      })}>
      <Avatar id={u.id} name={u.name} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong" numberOfLines={2}>
          {u.name}
          {u.id === me.id ? <T variant="meta" color="textMuted">{`  ${t('people.you', 'You')}`}</T> : null}
        </T>
        <T variant="meta" color="textMuted" numberOfLines={2}>
          {roleLabel(u)} · {u.email}
        </T>
      </View>
      <Feather name="chevron-right" size={18} color={c.textFaint} />
    </Pressable>
  );

  return (
    <Screen>
      <Header title={t('people.title', 'People')} subtitle={t('people.count', '{{count}} people', { count: users.list.filter((u) => u.isActive && !isBotUser(u)).length })} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ padding: space.lg, gap: space.md }}>
          {can('user.invite') ? (
            <Button icon="user-plus" kind="secondary" label={t('invite.title', 'Invite person')} onPress={() => setInviting(true)} />
          ) : null}
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={t('people.search', 'Search by name or email')}
            accessibilityLabel={t('people.search', 'Search by name or email')}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {active.length === 0 && inactive.length === 0 ? (
          <EmptyState icon="users" title={t('people.none', 'No one matches')} hint={t('people.noneHint', 'Try another name or email.')} />
        ) : (
          active.map(row)
        )}

        {inactive.length > 0 ? (
          <>
            <T variant="label" color="textMuted" style={{ paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm }}>
              {t('people.deactivatedSection', 'Deactivated')}
            </T>
            {inactive.map(row)}
          </>
        ) : null}
      </ScrollView>

      <InviteSheet me={me} visible={inviting} onClose={() => setInviting(false)} />

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={person?.name ?? ''} subtitle={person?.email}>
        {person ? (
          <View style={{ gap: space.lg }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Pill label={roleLabel(person)} bg={c.surfaceAlt} fg={c.textMuted} />
              {person.isActive ? null : <Pill label={t('people.deactivated', 'Deactivated')} bg={c.dangerSoft} fg={c.danger} />}
            </View>
            <View style={{ gap: space.sm }}>
              <T variant="label" color="textMuted">
                {/* A member's phone only holds their own projects, so they see the overlap only. */}
                {can('company.users') ? t('people.projects', 'Projects') : t('people.sharedProjects', 'Projects you share')}
              </T>
              {person.companyRole !== 'member' ? (
                <T variant="body">{t('people.seesAll', 'Sees every project in the company.')}</T>
              ) : personProjects.length === 0 ? (
                <T variant="body" color="textMuted">
                  {can('company.users') ? t('people.noProjects', 'Not on any project yet.') : t('people.noSharedProjects', 'No projects in common.')}
                </T>
              ) : (
                personProjects.map(({ m, p }) => (
                  <T key={m.projectId} variant="body">
                    {shortProjectName(p!.name)}
                    <T variant="body" color="textMuted">
                      {' · '}
                      {labels.project(m.role)} · {labels.jobTitle(m.jobTitle)}
                    </T>
                  </T>
                ))
              )}
            </View>
            {person.isActive && person.id !== me.id ? (
              <Button
                icon="message-circle"
                label={t('people.message', 'Message')}
                onPress={() => {
                  setOpen(null);
                  router.push(`/dm/${person.id}`);
                }}
              />
            ) : null}
            {person.canDeactivate ? (
              <Button
                kind="danger"
                icon="user-x"
                label={t('people.deactivate', 'Deactivate')}
                onPress={() => {
                  setOpen(null);
                  setConfirming(person);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet
        visible={!!confirming}
        onClose={() => setConfirming(null)}
        title={t('people.deactivateTitle', 'Deactivate {{name}}?', { name: confirming?.name ?? '' })}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {t(
            'people.deactivateBody',
            "{{name}} won't be able to sign in and will be removed from lists and pickers. Their messages, tasks and history stay. Their work email can be used again.",
            { name: firstName(confirming?.name) },
          )}
        </T>
        <Button
          kind="danger"
          label={t('people.deactivate', 'Deactivate')}
          onPress={() => {
            if (confirming) {
              deactivatePerson(confirming);
              toast(t('people.deactivatedToast', '{{name}} was deactivated.', { name: confirming.name }));
            }
            setConfirming(null);
          }}
        />
        <Button kind="ghost" label={t('common.cancel', 'Cancel')} onPress={() => setConfirming(null)} />
      </Sheet>
    </Screen>
  );
}

export default appScreen(PeopleScreen);
