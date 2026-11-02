// After the code: invites to accept and the companies this person can open (spec §5.1).
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Button } from '@/components/basics';
import { withBoundary } from '@/components/chrome';
import { CompanyTile } from '@/components/CompanyTile';
import { T } from '@/components/T';
import { acceptInvite, declineInvite, loadChoices, openCompany, type Choices } from '@/features/auth/api';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { endSession } from '@/lib/session';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

function CompanyPickerScreen() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const loaded = useQuery({ queryKey: ['auth-choices'], queryFn: loadChoices });
  const [declined, setDeclined] = useState<Choices | null>(null);
  const choices = declined ?? loaded.data ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isAppError(e) ? errorText(e) : errorText('UNKNOWN'));
    } finally {
      setBusy(null);
    }
  };

  const startOver = () => {
    endSession();
    router.replace('/login');
  };

  const row = (key: string, name: string, subtitle: string, onPress: () => void, right?: React.ReactNode) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      disabled={!!busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: touch.min + 16,
        paddingHorizontal: space.md,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? c.surfaceAlt : c.surface,
      })}>
      <CompanyTile name={name} size={36} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {name}
        </T>
        <T variant="meta" color="textMuted" numberOfLines={2}>
          {subtitle}
        </T>
      </View>
      {busy === key ? <ActivityIndicator color={c.accent} /> : (right ?? <Feather name="chevron-right" size={18} color={c.textFaint} />)}
    </Pressable>
  );

  const empty = choices && choices.companies.length === 0 && choices.invites.length === 0;
  return (
    <AuthShell
      back
      title={empty ? t('picker.noneTitle', 'Not in a company yet') : t('picker.title', 'Open a company')}
      subtitle={
        empty
          ? t('picker.noneHint', "You're not in a company on Siteline yet. Ask your admin to invite you.")
          : t('picker.hint', 'Pick where to work. You can switch later from the top of Home.')
      }
      footer={
        <Pressable accessibilityRole="button" onPress={startOver} style={{ alignItems: 'center', paddingVertical: space.sm }}>
          <T variant="metaStrong" color="accent">
            {t('picker.different', 'Use a different email or phone')}
          </T>
        </Pressable>
      }>
      {!choices ? <ActivityIndicator color={c.accent} /> : null}
      <View style={{ gap: space.sm }}>
        {choices?.invites.map((i) => (
          <View key={i.id} style={{ gap: space.sm, padding: space.md, borderRadius: radius.card, backgroundColor: c.accentSoft }}>
            <T variant="bodyStrong">
              {i.invitedBy
                ? t('picker.invitedBy', '{{who}} invited you to {{company}}', { who: i.invitedBy, company: i.companyName })
                : t('picker.invited', "You're invited to {{company}}", { company: i.companyName })}
            </T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                small
                label={t('picker.join', 'Join')}
                loading={busy === `join:${i.id}`}
                onPress={() =>
                  void run(`join:${i.id}`, async () => {
                    await acceptInvite(i.id);
                    await openCompany(i.companyId);
                  })
                }
              />
              <Button
                small
                kind="secondary"
                label={t('picker.notNow', 'Not now')}
                onPress={() => void run(`decline:${i.id}`, async () => setDeclined(await declineInvite(i.id)))}
              />
            </View>
          </View>
        ))}
        {choices?.companies.map((co) =>
          row(co.id, co.name, t(`you.${co.role}`, co.role), () => void run(co.id, () => openCompany(co.id))),
        )}
      </View>
      {loaded.isError ? (
        <T variant="meta" color="danger" style={{ marginTop: space.md }}>
          {errorText(isAppError(loaded.error) ? loaded.error : 'UNKNOWN')}
        </T>
      ) : null}
      {error ? (
        <T variant="meta" color="danger" style={{ marginTop: space.md }} accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </AuthShell>
  );
}

export default withBoundary(CompanyPickerScreen);
