import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, Card, Pill, Segmented, type IconName } from '@/components/basics';
import { appScreen, OfflineBanner, Screen } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { formatPhone } from '@/features/auth/api';
import { logOut, sendNow } from '@/features/profile/api';
import { shortProjectName, useAllProjectMembers, useMe, useProjects, useUnsentCount } from '@/features/shared';
import { useUi, type Language, type ThemePref } from '@/stores/ui';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

function SettingRow({ icon, label, right, onPress }: { icon: IconName; label: string; right?: React.ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ minHeight: touch.worker, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
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
  const projects = useProjects();
  const memberships = useAllProjectMembers().filter((m) => m.userId === me.id);
  const unsent = useUnsentCount();
  const ui = useUi();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const total = unsent.waiting + unsent.failed;
  const roleLabel = me.companyRole === 'owner' ? t('you.owner', 'Owner') : me.companyRole === 'admin' ? t('you.admin', 'Admin') : t('you.member', 'Member');
  const line = <View style={{ height: 1, backgroundColor: c.border }} />;

  return (
    <Screen>
      <OfflineBanner waiting={unsent.waiting} />
      {/* Keeps scrolled content from showing through the status bar. */}
      <View style={{ height: insets.top, backgroundColor: c.bg }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Avatar id={me.id} name={me.name} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="title">{me.name}</T>
            <T variant="meta" color="textMuted">
              +91 {formatPhone(me.phone)}
            </T>
            <Pill label={`Paliath Interiors · ${roleLabel}`} bg={c.surfaceAlt} fg={c.textMuted} />
          </View>
        </View>

        <View>
          <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
            {t('you.projects', 'Your projects')}
          </T>
          <Card style={{ padding: 0 }}>
            {me.companyRole !== 'member' ? (
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
                        {m.role === 'manager' ? t('you.manager', 'Manager') : t('you.member', 'Member')} · {t(`jobTitle.${m.jobTitle}`, m.jobTitle)}
                      </T>
                    </View>
                    <Feather name="chevron-right" size={18} color={c.textFaint} />
                  </Pressable>
                );
              })
            )}
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <T variant="label" color="textMuted">
            {t('you.language', 'Language')}
          </T>
          <Segmented<Language>
            value={ui.language}
            onChange={ui.setLanguage}
            options={[
              { value: 'en', label: 'English' },
              { value: 'kn', label: 'ಕನ್ನಡ' },
              { value: 'hi', label: 'हिंदी' },
            ]}
          />
        </View>

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

        <View>
          <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
            {t('you.notifications', 'Notifications')}
          </T>
          <Card style={{ padding: 0 }}>
            {(
              [
                ['messages', 'message-circle', t('you.notifyMessages', 'Messages and mentions')],
                ['tasks', 'check-square', t('you.notifyTasks', 'Task changes')],
                ['checkins', 'cpu', t('you.notifyCheckins', 'Bot check-ins')],
              ] as const
            ).map(([key, icon, label], i) => (
              <View key={key}>
                {i ? line : null}
                <SettingRow
                  icon={icon}
                  label={label}
                  right={
                    <Switch
                      value={ui.notifications[key]}
                      onValueChange={(v) => ui.setNotification(key, v)}
                      trackColor={{ true: c.accent, false: c.border }}
                      thumbColor={c.surface}
                      accessibilityLabel={label}
                    />
                  }
                />
              </View>
            ))}
          </Card>
        </View>

        <View>
          <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
            {t('you.sending', 'Sending')}
          </T>
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
            {line}
            <SettingRow icon="send" label={t('you.sendNow', 'Send now')} onPress={sendNow} right={<Feather name="chevron-right" size={18} color={c.textFaint} />} />
            {ui.demoPillHidden ? (
              <>
                {line}
                <SettingRow icon="sliders" label={t('you.showDemo', 'Show the Demo button')} onPress={() => ui.set({ demoPillHidden: false })} />
              </>
            ) : null}
          </Card>
        </View>

        <Button kind="secondary" icon="log-out" label={t('you.logout', 'Log out')} onPress={() => (total > 0 ? setConfirmLogout(true) : logOut())} />
        <T variant="meta" color="textFaint" style={{ textAlign: 'center' }}>
          Siteline · demo build
        </T>
      </ScrollView>

      <Sheet visible={confirmLogout} onClose={() => setConfirmLogout(false)} title={t('you.logoutTitle', 'Log out?')}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {total === 1
            ? t('you.logoutWarningOne', "1 change hasn't been sent yet. Log out anyway?")
            : t('you.logoutWarning', "{{count}} changes haven't been sent yet. Log out anyway?", { count: total })}
        </T>
        <Button
          kind="danger"
          label={t('you.logoutAnyway', 'Log out anyway')}
          onPress={() => {
            setConfirmLogout(false);
            logOut();
          }}
        />
        <Button kind="ghost" label={t('you.stay', 'Stay signed in')} onPress={() => setConfirmLogout(false)} />
      </Sheet>
    </Screen>
  );
}

export default appScreen(YouScreen);
