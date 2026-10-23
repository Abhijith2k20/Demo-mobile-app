// Screen-level pieces: Header, Screen, ErrorBoundary, Toast, OfflineBanner.
import { router } from 'expo-router';
import { Component, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '@/lib/i18n';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { motion, radius, space } from '@/theme/spacing';
import { useLargeText, useTheme } from '@/theme/useTheme';
import { Banner, Button, EmptyState, IconButton } from './basics';
import { T } from './T';

export function Header({
  title,
  subtitle,
  right,
  back = true,
  onTitlePress,
  close,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
  onTitlePress?: () => void;
  close?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const large = useLargeText();
  return (
    <View style={{ backgroundColor: c.surface, paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
        {back ? (
          <IconButton
            icon={close ? 'x' : Platform.OS === 'ios' ? 'chevron-left' : 'arrow-left'}
            label={t('common.back', 'Back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        ) : (
          <View style={{ width: space.md }} />
        )}
        <Pressable onPress={onTitlePress} disabled={!onTitlePress} style={{ flex: 1, paddingVertical: space.xs }}>
          <T variant="heading" numberOfLines={2}>
            {title}
          </T>
          {subtitle ? (
            <T variant="meta" color="textMuted" numberOfLines={large ? 2 : 1}>
              {subtitle}
            </T>
          ) : null}
        </Pressable>
        {right}
      </View>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={{ flex: 1, backgroundColor: c.bg }}>{children}</View>;
}

export function OfflineBanner({ waiting }: { waiting: number }) {
  const online = useUi((s) => s.online);
  const { t } = useTranslation();
  if (online) return null;
  return (
    <Banner
      icon="wifi-off"
      text={t('offline.banner', "You're offline. Changes will send automatically.")}
      right={waiting > 0 ? t('offline.waiting', '{{count}} waiting', { count: waiting }) : undefined}
    />
  );
}

function Fallback({ onReset }: { onReset: () => void }) {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="alert-triangle"
          title={i18n.t('errors.boundaryTitle', 'Something went wrong')}
          hint={i18n.t('errors.boundaryHint', 'This screen had a problem. Your data is safe.')}
          action={
            <Button
              label={i18n.t('common.goBack', 'Go back')}
              full={false}
              kind="secondary"
              onPress={() => {
                onReset();
                if (router.canGoBack()) router.back();
                else router.replace('/');
              }}
            />
          }
        />
      </View>
    </Screen>
  );
}

/** Wraps each tab and stack screen so one broken screen never takes the app down. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[ErrorBoundary]', error);
  }
  render() {
    if (this.state.failed) return <Fallback onReset={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

export function withBoundary<P extends object>(Inner: React.ComponentType<P>) {
  return function Bounded(props: P) {
    return (
      <ErrorBoundary>
        <Inner {...props} />
      </ErrorBoundary>
    );
  };
}

/** For signed-in screens: error boundary + render nothing once the session is gone. */
export function appScreen<P extends object>(Inner: React.ComponentType<P>) {
  return function Guarded(props: P) {
    const user = useSession((s) => s.user);
    if (!user) return null;
    return (
      <ErrorBoundary>
        <Inner {...props} />
      </ErrorBoundary>
    );
  };
}

export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const hide = useUi((s) => s.hideToast);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const timer = setTimeout(() => hide(id), 4500);
    return () => clearTimeout(timer);
  }, [toast, hide]);
  if (!toast) return null;
  const fg = toast.tone === 'danger' ? c.danger : toast.tone === 'success' ? c.success : c.text;
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInUp.duration(motion.base)}
      exiting={FadeOutUp.duration(motion.fast)}
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + space.sm, left: space.lg, right: space.lg, zIndex: 50 }}>
      <Pressable
        accessibilityRole="alert"
        onPress={() => hide(toast.id)}
        style={{
          backgroundColor: c.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: toast.tone === 'danger' ? c.danger : c.border,
          padding: space.md,
          shadowColor: c.shadow,
          shadowOpacity: 0.15,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}>
        <T variant="meta" style={{ color: fg }}>
          {toast.text}
        </T>
      </Pressable>
    </Animated.View>
  );
}
