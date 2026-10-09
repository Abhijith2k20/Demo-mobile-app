import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { Avatar, Button } from '@/components/basics';
import { withBoundary } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { formatPhone, requestOtp } from '@/features/auth/api';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { DEMO_USERS } from '@/features/auth/demoUsers';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { radius, space } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

function LoginScreen() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const digits = phone.replace(/\D/g, '');

  const submit = async (number = digits) => {
    if (number.length !== 10) {
      setError(t('auth.phoneInvalid', 'Enter your 10-digit mobile number.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestOtp(number);
      router.push({ pathname: '/otp', params: { phone: number } });
    } catch (e) {
      setError(isAppError(e) ? errorText(e) : errorText('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.signIn', 'Sign in')}
      subtitle={t('auth.signInHint', "Enter your mobile number and we'll text you a 6-digit code.")}
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
            {t('auth.help', "Can't sign in? Ask your company admin to add your number.")}
          </T>
        </View>
      }>
      <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
        {t('auth.phone', 'Mobile number')}
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
        <T style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, color: c.textMuted, paddingLeft: space.lg, paddingRight: space.md }}>+91</T>
        <View style={{ width: 1, height: 26, backgroundColor: c.border }} />
        <TextInput
          value={formatPhone(phone)}
          onChangeText={(v) => {
            setPhone(v.replace(/\D/g, '').slice(0, 10));
            setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="00000 00000"
          placeholderTextColor={c.textFaint}
          accessibilityLabel={t('auth.phone', 'Mobile number')}
          style={{ flex: 1, color: c.text, fontFamily: fonts.semibold, fontSize: 18, letterSpacing: 1, paddingHorizontal: space.md, paddingVertical: 0 }}
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
      <Button label={t('auth.continue', 'Continue')} onPress={() => void submit()} loading={busy} disabled={digits.length !== 10} style={{ marginTop: space.lg, minHeight: 54 }} />

      <Sheet
        visible={demo}
        onClose={() => setDemo(false)}
        title={t('auth.demoTitle', 'Demo accounts')}
        subtitle={t('auth.demoHint', 'Pick a person to sign in as. The code is always 123456.')}>
        <View style={{ marginHorizontal: -space.lg }}>
          {DEMO_USERS.map((u) => (
            <Pressable
              key={u.phone}
              accessibilityRole="button"
              accessibilityLabel={`${u.name}, ${u.subtitle}`}
              onPress={() => {
                setPhone(u.phone);
                setError(null);
                setDemo(false);
                void submit(u.phone);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                minHeight: 56,
                backgroundColor: pressed ? c.surfaceAlt : 'transparent',
              })}>
              <Avatar id={u.phone} name={u.name} size={36} />
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
