import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button } from '@/components/basics';
import { Screen, withBoundary } from '@/components/chrome';
import { CompanyTile } from '@/components/CompanyTile';
import { T } from '@/components/T';
import { formatPhone, requestOtp } from '@/features/auth/api';
import { DEMO_USERS } from '@/features/auth/demoUsers';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

function LoginScreen() {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = phone.replace(/\D/g, '');

  const submit = async () => {
    if (digits.length !== 10) {
      setError(t('auth.phoneInvalid', 'Enter your 10-digit mobile number.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestOtp(digits);
      router.push({ pathname: '/otp', params: { phone: digits } });
    } catch (e) {
      setError(isAppError(e) ? errorText(e) : errorText('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }}>
          <CompanyTile />
          <T variant="title" style={{ marginTop: space.lg }}>
            {t('auth.title', 'Sign in to Aanya Interiors')}
          </T>
          <T variant="meta" color="textMuted" style={{ marginTop: 4, marginBottom: space.xl }}>
            {t('auth.subtitle', 'Siteline keeps your projects, site updates and tasks in one place.')}
          </T>

          <T variant="label" color="textMuted" style={{ marginBottom: 6 }}>
            {t('auth.phone', 'Mobile number')}
          </T>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: error ? c.danger : c.border,
              borderRadius: radius.input,
              minHeight: 52,
            }}>
            <T variant="bodyStrong" color="textMuted" style={{ paddingHorizontal: space.md }}>
              +91
            </T>
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: c.border }} />
            <TextInput
              value={formatPhone(phone)}
              onChangeText={(v) => {
                setPhone(v.replace(/\D/g, '').slice(0, 10));
                setError(null);
              }}
              keyboardType="phone-pad"
              placeholder="98450 00000"
              placeholderTextColor={c.textFaint}
              accessibilityLabel={t('auth.phone', 'Mobile number')}
              style={[type.body, { flex: 1, color: c.text, paddingHorizontal: space.md, letterSpacing: 0.5 }]}
              onSubmitEditing={() => void submit()}
            />
          </View>
          {error ? (
            <T variant="meta" color="danger" style={{ marginTop: 6 }}>
              {error}
            </T>
          ) : null}
          <Button label={t('auth.sendCode', 'Send code')} onPress={() => void submit()} loading={busy} style={{ marginTop: space.lg }} />

          <View style={{ marginTop: space.xxl }}>
            <T variant="label" color="textFaint" style={{ marginBottom: space.sm }}>
              {t('auth.demoAs', 'Demo: sign in as')}
            </T>
            <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
              {DEMO_USERS.map((u, i) => (
                <Pressable
                  key={u.phone}
                  accessibilityRole="button"
                  accessibilityLabel={`${u.name}, ${u.subtitle}`}
                  onPress={() => {
                    setPhone(u.phone);
                    setError(null);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.md,
                    minHeight: 52,
                    backgroundColor: pressed || digits === u.phone ? c.surfaceAlt : 'transparent',
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                  })}>
                  <Avatar id={u.phone} name={u.name} size={32} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" numberOfLines={1}>
                      {u.name}
                    </T>
                    <T variant="meta" color="textMuted">
                      {u.subtitle}
                    </T>
                  </View>
                  <T variant="meta" color="textFaint">
                    {formatPhone(u.phone)}
                  </T>
                </Pressable>
              ))}
            </View>
            <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
              {t('auth.demoHint', 'Tap a person to fill the number. The code is 123456.')}
            </T>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default withBoundary(LoginScreen);
