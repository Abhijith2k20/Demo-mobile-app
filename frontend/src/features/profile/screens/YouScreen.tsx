import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, Card, Pill, Segmented, type IconName } from '@/components/basics';
import { appScreen, OfflineBanner, Screen } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { useUnsentCount } from '@/lib/outbox';
import { get, keys } from '@/lib/queries';
import { deleteAccount, logOut, saveNotifyPrefs, type NotifyPrefs } from '@/features/profile/api';
import { InviteSheet } from '@/features/people/components/InviteSheet';
import { shortProjectName, useAllProjectMembers, useCan, useCompany, useMe, useProjects, useRoleLabels } from '@/features/shared';
import { CompanySwitcher } from '@/features/shared/CompanySwitcher';
import { useSession } from '@/stores/session';
import { toast, useUi, type ThemePref } from '@/stores/ui';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

function SettingRow({ icon, label, right, onPress }: { icon: IconName; label: string; right?: React.ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ minHeight: touch.large, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      <Feather name={icon} size={18} color={c.textMuted} />
      <T variant="body" style={{ flex: 1 }}>
        {label}
      </T>
      {right}
    </Pressable>
  );
}

function YouScreen() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const can = useCan();
  const projects = useProjects();
  const memberships = useAllProjectMembers().filter((m) => m.userId === me.id);
  const ui = useUi();
  const [inviting, setInviting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const unsent = useUnsentCount();
  const total = unsent.waiting + unsent.failed;
  const labels = useRoleLabels();
  const company = useCompany();
  const companies = useSession((s) => s.companies) ?? [];
  const notify = useQuery({ queryKey: keys.me, queryFn: get<{ notify: NotifyPrefs }>('/me') }).data?.notify;
  const [switching, setSwitching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const roleLabel = labels.company(me.companyRole);
  const admin = me.companyRole === 'owner' || me.companyRole === 'admin';
  const line = <View style={{ height: 1, backgroundColor: c.border }} />;

  return (
    <Screen>
      <OfflineBanner />
      {/* Keeps scrolled content from showing through the status bar. */}
      <View style={{ height: insets.top, backgroundColor: c.bg }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Avatar id={me.id} name={me.name} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="title">{me.name}</T>
            <T variant="meta" color="textMuted">
              {me.email ?? me.phone}
            </T>
            <Pill label={`${company?.name ?? ''} · ${roleLabel}`} bg={c.surfaceAlt} fg={c.textMuted} />
          </View>
        </View>

        <View>
          <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
            {t('you.projects', 'Your projects')}
          </T>
          <Card style={{ padding: 0 }}>
            {admin ? (
              <View style={{ padding: space.md }}>
                <T variant="body">{t('you.seesAll', 'You can see every project in the company.')}</T>
              </View>
            ) : memberships.length === 0 ? (
              <View style={{ padding: space.md }}>
                <T variant="body" color="textMuted">
                  {t('home.noProjects', "You're not on any project yet. A manager can add you.")}
                </T>
              </View>
            ) : (
              memberships.map((m, i) => {
                const p = projects.byId.get(m.projectId);
                if (!p) return null;
                return (
                  <Pressable
                    key={m.projectId}
                    onPress={() => router.push(`/project/${m.projectId}`)}
                    style={{ padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ flex: 1 }}>
                      <T variant="bodyStrong" numberOfLines={1}>
                        {shortProjectName(p.name)}
                      </T>
                      <T variant="meta" color="textMuted">
                        {labels.project(m.role)} · {labels.jobTitle(m.jobTitle)}
                      </T>
                    </View>
                    <Feather name="chevron-right" size={18} color={c.textFaint} />
                  </Pressable>
                );
              })
            )}
          </Card>
        </View>

        <View>
          <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
            {t('you.company', 'Company')}
          </T>
          <Card style={{ padding: 0 }}>
            {companies.length > 1 ? (
              <>
                <SettingRow
                  icon="repeat"
                  label={t('you.switchCompany', 'Switch company')}
                  onPress={() => setSwitching(true)}
                  right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
                />
                {line}
              </>
            ) : null}
            {me.companyRole !== 'guest' ? (
              <SettingRow icon="users" label={t('people.title', 'People')} onPress={() => router.push('/people')} right={<Feather name="chevron-right" size={18} color={c.textFaint} />} />
            ) : null}
            {can('user.invite') ? (
              <>
                {line}
                <SettingRow
                  icon="user-plus"
                  label={t('invite.title', 'Invite person')}
                  onPress={() => setInviting(true)}
                  right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
                />
                {line}
                <SettingRow icon="mail" label={t('invites.title', 'Invites')} onPress={() => router.push('/invites')} right={<Feather name="chevron-right" size={18} color={c.textFaint} />} />
              </>
            ) : null}
            {can('pm.status') ? (
              <>
                {line}
                <SettingRow
                  icon="link"
                  label={t('pm.title', 'PM app link')}
                  onPress={() => router.push('/integration')}
                  right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
                />
              </>
            ) : null}
          </Card>
          <InviteSheet visible={inviting} onClose={() => setInviting(false)} />
        </View>

        {/* iOS follows the system appearance; Android users expect an in-app choice. */}
        {Platform.OS === 'ios' ? null : (
        <View style={{ gap: space.sm }}>
          <T variant="label" color="textMuted">
            {t('you.theme', 'Theme')}
          </T>
          <Segmented<ThemePref>
            value={ui.theme}
            onChange={ui.setTheme}
            options={[
              { value: 'system', label: t('you.themeSystem', 'System') },
              { value: 'light', label: t('you.themeLight', 'Light') },
              { value: 'dark', label: t('you.themeDark', 'Dark') },
            ]}
          />
        </View>
        )}

        <View>
          <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
            {t('you.notifications', 'Notifications')}
          </T>
          <Segmented<NotifyPrefs['level']>
            value={notify?.level ?? 'all'}
            onChange={(level) => void saveNotifyPrefs({ level })}
            options={[
              { value: 'all', label: t('you.notifyAll', 'All') },
              { value: 'important', label: t('you.notifyImportant', 'Important') },
              { value: 'off', label: t('you.notifyOff', 'Off') },
            ]}
          />
          <T variant="meta" color="textMuted" style={{ marginTop: space.xs }}>
            {notify?.level === 'off'
              ? t('you.notifyOffHint', 'No notifications. Open the app to see what changed.')
              : notify?.level === 'important'
                ? t('you.notifyImportantHint', 'Direct messages, mentions and cards.')
                : t('you.notifyAllHint', 'Also replies in threads you are part of.')}
          </T>
        </View>

        <Card style={{ padding: 0 }}>
          <SettingRow
            icon="inbox"
            label={t('unsent.title', 'Unsent items')}
            onPress={() => router.push('/unsent')}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {unsent.failed > 0 ? <Badge count={unsent.failed} /> : <Badge count={unsent.waiting} muted />}
                <Feather name="chevron-right" size={18} color={c.textFaint} />
              </View>
            }
          />
          {ui.demoPillHidden ? (
            <>
              {line}
              <SettingRow icon="sliders" label={t('you.showDemo', 'Show the dev button')} onPress={() => ui.set({ demoPillHidden: false })} />
            </>
          ) : null}
        </Card>

        <Button kind="secondary" icon="log-out" label={t('you.logout', 'Log out')} onPress={() => (total > 0 ? setConfirmLogout(true) : void logOut())} />
        <Button kind="ghost" icon="trash-2" label={t('you.deleteAccount', 'Delete my account')} onPress={() => setConfirmDelete(true)} />
      </ScrollView>

      <Sheet visible={confirmLogout} onClose={() => setConfirmLogout(false)} title={t('you.logoutTitle', 'Log out?')}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {t('you.logoutWarning', "{{count}} changes haven't been sent yet. Logging out deletes them.", { count: total })}
        </T>
        <Button
          kind="danger"
          label={t('you.logoutAnyway', 'Log out anyway')}
          onPress={() => {
            setConfirmLogout(false);
            void logOut();
          }}
        />
        <Button kind="ghost" label={t('you.stay', 'Stay signed in')} onPress={() => setConfirmLogout(false)} />
      </Sheet>

      <CompanySwitcher visible={switching} onClose={() => setSwitching(false)} />

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('you.deleteTitle', 'Delete your account?')}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {t('you.deleteBody', 'Your name, email and phone are removed from every company. Your messages stay, shown as "Former member". This cannot be undone.')}
        </T>
        <Button
          kind="danger"
          label={t('you.deleteConfirm', 'Delete my account')}
          onPress={async () => {
            setConfirmDelete(false);
            try {
              await deleteAccount();
            } catch {
              toast(t('you.deleteFailed', "Couldn't delete your account. Check your connection."), 'danger');
            }
          }}
        />
        <Button kind="ghost" label={t('common.cancel', 'Cancel')} onPress={() => setConfirmDelete(false)} />
      </Sheet>
    </Screen>
  );
}

export default appScreen(YouScreen);
