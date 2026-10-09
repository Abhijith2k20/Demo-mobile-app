import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native';
import { Button } from '@/components/basics';
import { Header, Screen, withBoundary } from '@/components/chrome';
import { T } from '@/components/T';
import { formatPhone, requestOtp, verifyOtp } from '@/features/auth/api';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

const LENGTH = 6;

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

  const verify = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, code); // the auth gate moves us to Home
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

  return (
    <Screen>
      <Header title={t('auth.enterCode', 'Enter the code')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ padding: space.xl, gap: space.lg }}>
          <T variant="body" color="textMuted">
            {t('auth.codeSent', 'We sent a 6-digit code to +91 {{phone}}.', { phone: formatPhone(phone) })}
          </T>
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityLabel={t('auth.codeField', '6-digit code')}
            style={{ flexDirection: 'row', gap: space.sm }}>
            {Array.from({ length: LENGTH }).map((_, i) => {
              const active = focused && i === Math.min(code.length, LENGTH - 1);
              return (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 56,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: c.surface,
                    borderRadius: radius.input,
                    borderWidth: 1.5,
                    borderColor: error ? c.danger : active || code[i] ? c.accent : c.border,
                  }}>
                  <T variant="title">{code[i] ?? ''}</T>
                </View>
              );
            })}
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
              style={{ position: 'absolute', width: '100%', height: 56, opacity: 0.01, color: 'transparent' }}
            />
          </Pressable>
          {error ? (
            <T variant="meta" color="danger" accessibilityRole="alert">
              {error}
            </T>
          ) : null}
          {busy ? <Button label={t('auth.signingIn', 'Signing in…')} onPress={() => {}} loading /> : null}
          <Pressable disabled={seconds > 0} onPress={() => void resend()} hitSlop={10}>
            <T variant="metaStrong" color={seconds > 0 ? 'textFaint' : 'accent'}>
              {seconds > 0
                ? t('auth.resendIn', 'Resend code in 0:{{s}}', { s: String(seconds).padStart(2, '0') })
                : t('auth.resend', 'Resend code')}
            </T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default withBoundary(OtpScreen);
