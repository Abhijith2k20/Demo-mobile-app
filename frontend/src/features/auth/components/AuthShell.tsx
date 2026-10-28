// Shared layout for the sign-in screens: an ink brand header (the same "title block" as Home)
// over a clean card that holds the form.
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanyTile } from '@/components/CompanyTile';
import { T } from '@/components/T';
import { useCompany } from '@/features/shared';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

interface Props {
  /** Shows a back arrow in the header (second step). */
  back?: boolean;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  /** Small print under the card. */
  footer?: ReactNode;
}

export function AuthShell({ back, title, subtitle, children, footer }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const company = useCompany();

  return (
    <View style={{ flex: 1, backgroundColor: c.header }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} bounces={false}>
          {/* Brand header */}
          <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.xl, paddingBottom: space.xxl + space.sm }}>
            <View style={{ height: touch.min, justifyContent: 'center', marginLeft: -space.sm }}>
              {back ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.back', 'Back')}
                  hitSlop={8}
                  onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
                  style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="arrow-left" size={22} color={c.onHeader} />
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg }}>
              <CompanyTile name={company?.name ?? ''} size={48} />
              <View style={{ flex: 1 }}>
                <T variant="title" style={{ color: c.onHeader }} numberOfLines={1}>
                  {company?.name ?? ''}
                </T>
                <T variant="meta" style={{ color: c.onHeader, opacity: 0.65 }}>
                  {t('auth.workspace', 'Siteline workspace')}
                </T>
              </View>
            </View>
          </View>

          {/* Form card */}
          <View
            style={{
              flexGrow: 1,
              backgroundColor: c.bg,
              borderTopLeftRadius: radius.sheet + 4,
              borderTopRightRadius: radius.sheet + 4,
              paddingHorizontal: space.xl,
              paddingTop: space.xl + space.xs,
              paddingBottom: insets.bottom + space.xl,
            }}>
            <T variant="title" style={{ fontSize: 24, lineHeight: 30 }}>
              {title}
            </T>
            <T variant="body" color="textMuted" style={{ marginTop: 6, marginBottom: space.xl }}>
              {subtitle}
            </T>
            {children}
            <View style={{ flexGrow: 1, minHeight: space.xl }} />
            {footer}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
