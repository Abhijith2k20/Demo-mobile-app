import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { Avatar, Button } from '@/components/basics';
import { withBoundary } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { looksLikeIdentifier, requestCode } from '@/features/auth/api';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { useDemoAccounts } from '../hooks';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { radius, space } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

function LoginScreen() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const demoUsers = useDemoAccounts();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const address = identifier.trim();

  const submit = async (value = address, company?: string) => {
    if (!looksLikeIdentifier(value)) {
      setError(t('auth.identifierInvalid', 'Enter your work email, like name@company.com.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestCode(value);
      router.push({ pathname: '/otp', params: { identifier: value, ...(company ? { company } : {}) } });
    } catch (e) {
      setError(isAppError(e) ? errorText(e) : errorText('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.signIn', 'Sign in')}
      subtitle={t('auth.signInHint', 'Enter your work email to get a 6-digit code.')}
      footer={
        <View style={{ alignItems: 'center', gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setDemo(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.sm }}>
            <Feather name="users" size={15} color={c.accent} />
            <T variant="metaStrong" color="accent">
              {t('auth.useDemo', 'Use a demo account')}
            </T>
          </Pressable>
          <T variant="meta" color="textFaint" style={{ textAlign: 'center' }}>
            {t('auth.help', "Can't sign in? Ask your company admin to invite you.")}
          </T>
        </View>
      }>
      <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
        {t('auth.identifier', 'Work email')}
      </T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: c.surface,
          borderWidth: 1.5,
          borderColor: error ? c.danger : focused ? c.accent : c.border,
          borderRadius: radius.card,
          height: 58,
        }}>
        <TextInput
          value={identifier}
          onChangeText={(v) => {
            setIdentifier(v);
            setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="email-address"
          autoComplete="username"
          textContentType="username"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          placeholder={t('auth.identifierPlaceholder', 'name@company.com or 98765 43210')}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={t('auth.identifier', 'Work email')}
          style={{ flex: 1, color: c.text, fontFamily: fonts.semibold, fontSize: 17, paddingHorizontal: space.lg, paddingVertical: 0 }}
          onSubmitEditing={() => void submit()}
        />
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm }} accessibilityRole="alert">
          <Feather name="alert-circle" size={14} color={c.danger} />
          <T variant="meta" color="danger" style={{ flex: 1 }}>
            {error}
          </T>
        </View>
      ) : null}
      <Button label={t('auth.continue', 'Continue')} onPress={() => void submit()} loading={busy} disabled={!address} style={{ marginTop: space.lg, minHeight: 54 }} />

      <Sheet
        visible={demo}
        onClose={() => setDemo(false)}
        title={t('auth.demoTitle', 'Demo accounts')}
        subtitle={t('auth.demoHint', 'Pick a person to sign in as. The code is always 123456.')}>
        <View style={{ marginHorizontal: -space.lg }}>
          {demoUsers.map((u) => (
            <Pressable
              key={`${u.company}:${u.identifier}`}
              accessibilityRole="button"
              accessibilityLabel={`${u.name}, ${u.subtitle}`}
              onPress={() => {
                setIdentifier(u.identifier);
                setError(null);
                setDemo(false);
                void submit(u.identifier, u.company);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                minHeight: 56,
                backgroundColor: pressed ? c.surfaceAlt : 'transparent',
              })}>
              <Avatar id={u.identifier} name={u.name} size={36} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong" numberOfLines={1}>
                  {u.name}
                </T>
                <T variant="meta" color="textMuted">
                  {u.subtitle}
                </T>
              </View>
              <Feather name="chevron-right" size={18} color={c.textFaint} />
            </Pressable>
          ))}
        </View>
      </Sheet>
    </AuthShell>
  );
}

export default withBoundary(LoginScreen);
