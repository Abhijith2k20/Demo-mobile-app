import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { withBoundary } from '@/components/chrome';
import { T } from '@/components/T';
import { formatPhone, requestOtp, verifyOtp } from '@/features/auth/api';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { radius, space } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

const LENGTH = 6;
const BOX_HEIGHT = 60;

function OtpScreen({ phone }: { phone: string }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(30);
  const inputRef = useRef<TextInput>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, value); // the auth gate moves us to Home
    } catch (e) {
      if (!mounted.current) return;
      setError(isAppError(e) ? errorText(e) : errorText('UNKNOWN'));
      setCode('');
      inputRef.current?.focus();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // One hidden input holds the whole code (so fast typing and SMS autofill never drop digits);
  // the six boxes only display it.
  const onChange = (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, LENGTH);
    setCode(clean);
    setError(null);
    if (clean.length === LENGTH) void verify(clean);
  };

  const resend = async () => {
    try {
      await requestOtp(phone);
      setSeconds(30);
      setError(null);
    } catch (e) {
      setError(isAppError(e) ? errorText(e) : errorText('UNKNOWN'));
    }
  };

  const box = (i: number) => {
    const active = focused && !busy && i === Math.min(code.length, LENGTH - 1);
    return (
      <View
        key={i}
        style={{
          flex: 1,
          height: BOX_HEIGHT,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surface,
          borderRadius: radius.card,
          borderWidth: 1.5,
          borderColor: error ? c.danger : active ? c.accent : code[i] ? c.textFaint : c.border,
        }}>
        {code[i] ? (
          <T style={{ fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, color: c.text }} maxFontSizeMultiplier={1.1}>
            {code[i]}
          </T>
        ) : active ? (
          <View style={{ width: 2, height: 24, borderRadius: 1, backgroundColor: c.accent }} />
        ) : null}
      </View>
    );
  };

  return (
    <AuthShell
      back
      title={t('auth.enterCode', 'Enter the code')}
      subtitle={
        <>
          {t('auth.codeSentTo', 'Sent by text to')}{' '}
          <T variant="bodyStrong">+91 {formatPhone(phone)}</T>
          {'  '}
          <T variant="bodyStrong" color="accent" onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} accessibilityRole="link">
            {t('auth.change', 'Change')}
          </T>
        </>
      }
      footer={
        <T variant="meta" color="textFaint" style={{ textAlign: 'center' }}>
          {t('auth.demoCode', 'Demo build: the code is 123456.')}
        </T>
      }>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessibilityLabel={t('auth.codeField', '6-digit code')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {[0, 1, 2].map(box)}
        {/* A small gap makes six digits easier to read as two groups of three. */}
        <View style={{ width: space.sm, height: 2, borderRadius: 1, backgroundColor: c.border }} />
        {[3, 4, 5].map(box)}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LENGTH}
          editable={!busy}
          caretHidden
          style={{ position: 'absolute', width: '100%', height: BOX_HEIGHT, opacity: 0.01, color: 'transparent' }}
        />
      </Pressable>

      <View style={{ minHeight: 28, marginTop: space.md, justifyContent: 'center' }}>
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <ActivityIndicator size="small" color={c.accent} />
            <T variant="meta" color="textMuted">
              {t('auth.signingIn', 'Signing in…')}
            </T>
          </View>
        ) : error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="alert">
            <Feather name="alert-circle" size={14} color={c.danger} />
            <T variant="meta" color="danger" style={{ flex: 1 }}>
              {error}
            </T>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.lg }}>
        <T variant="meta" color="textMuted">
          {t('auth.noCode', "Didn't get it?")}
        </T>
        {seconds > 0 ? (
          <T variant="metaStrong" color="textFaint">
            {t('auth.resendIn', 'Resend in 0:{{s}}', { s: String(seconds).padStart(2, '0') })}
          </T>
        ) : (
          <Pressable onPress={() => void resend()} hitSlop={10} accessibilityRole="button">
            <T variant="metaStrong" color="accent">
              {t('auth.resend', 'Resend code')}
            </T>
          </Pressable>
        )}
      </View>
    </AuthShell>
  );
}

export default withBoundary(OtpScreen);
