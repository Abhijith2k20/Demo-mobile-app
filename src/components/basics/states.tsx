// What a screen shows besides content: banners, empty states, loading skeletons.
import { Feather } from '@expo/vector-icons';
import { useEffect, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { T } from '../T';
import { type IconName } from './identity';

export function Banner({
  text,
  tone = 'warning',
  icon,
  right,
  onPress,
}: {
  text: string;
  tone?: 'warning' | 'danger' | 'info';
  icon?: IconName;
  right?: string;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const bg = { warning: c.warningSoft, danger: c.dangerSoft, info: c.infoSoft }[tone];
  const fg = { warning: c.warning, danger: c.danger, info: c.info }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="alert"
      style={{
        backgroundColor: bg,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
      }}>
      {icon ? <Feather name={icon} size={16} color={fg} /> : null}
      <T variant="meta" style={{ flex: 1, color: c.text }}>
        {text}
      </T>
      {right ? (
        <T variant="metaStrong" style={{ color: fg }}>
          {right}
        </T>
      ) : null}
    </Pressable>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: IconName; title: string; hint?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.xl, gap: space.sm }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.card,
          backgroundColor: c.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.xs,
        }}>
        <Feather name={icon} size={24} color={c.textMuted} />
      </View>
      <T variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {hint ? (
        <T variant="meta" color="textMuted" style={{ textAlign: 'center' }}>
          {hint}
        </T>
      ) : null}
      {action}
    </View>
  );
}

/** Loading placeholder rows (we use these instead of spinners). */
export function Skeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!reduced) pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [pulse, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View style={[{ padding: space.lg, gap: space.lg }, style]} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          {avatar ? <View style={{ width: 36, height: 36, borderRadius: radius.avatar, backgroundColor: c.surfaceAlt }} /> : null}
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 12, width: `${40 + ((i * 17) % 30)}%`, borderRadius: 6, backgroundColor: c.surfaceAlt }} />
            <View style={{ height: 12, width: `${60 + ((i * 23) % 35)}%`, borderRadius: 6, backgroundColor: c.surfaceAlt }} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}
