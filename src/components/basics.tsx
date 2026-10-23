// Small building blocks: Avatar, Badge, Pill, Button, IconButton, Chip, Segmented, Row,
// SectionHeader, Banner, EmptyState, Skeleton, Card, Divider.
import { Feather } from '@expo/vector-icons';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { avatarTone, stageColors, type ColorToken } from '@/theme/colors';
import { radius, space, touch } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';
import type { Stage } from '@/types/models';
import { T } from './T';

export type IconName = keyof typeof Feather.glyphMap;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase();
}

export function Avatar({ id, name, size = 36, bot }: { id: string; name: string; size?: number; bot?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size <= 24 ? 6 : radius.avatar,
        backgroundColor: bot ? c.headerField : avatarTone(id),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {bot ? (
        <Feather name="cpu" size={size * 0.5} color={c.onHeader} />
      ) : (
        <T style={{ color: c.onColor, fontFamily: fonts.semibold, fontSize: size * 0.38, lineHeight: size * 0.5 }} maxFontSizeMultiplier={1}>
          {initials(name)}
        </T>
      )}
    </View>
  );
}

export function Badge({ count, muted }: { count: number; muted?: boolean }) {
  const { c } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: radius.pill,
        backgroundColor: muted ? c.surfaceAlt : c.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <T variant="label" style={{ color: muted ? c.textMuted : c.onAccent, letterSpacing: 0 }} maxFontSizeMultiplier={1}>
        {count > 99 ? '99+' : count}
      </T>
    </View>
  );
}

export function Pill({ label, bg, fg, icon }: { label: string; bg: string; fg: string; icon?: IconName }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: bg,
        alignSelf: 'flex-start',
      }}>
      {icon ? <Feather name={icon} size={11} color={fg} /> : null}
      {/* Sentence case: calmer than the uppercase label style, and easier to read. */}
      <T variant="label" style={{ color: fg, letterSpacing: 0, textTransform: 'none' }} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

export function StagePill({ stage, label }: { stage: Stage; label: string }) {
  const { c } = useTheme();
  const s = stageColors(c, stage);
  // Wrapped so it centres in rows (the pill itself hugs the start of columns).
  return (
    <View>
      <Pill label={label} bg={s.bg} fg={s.fg} />
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, kind = 'primary', icon, disabled, loading, full = true, small, style }: ButtonProps) {
  const { c, worker } = useTheme();
  const bg = { primary: c.accent, secondary: c.surfaceAlt, ghost: 'transparent', danger: c.dangerSoft }[kind];
  const fg = { primary: c.onAccent, secondary: c.text, ghost: c.accent, danger: c.danger }[kind];
  const height = small ? 36 : worker ? touch.worker + 4 : touch.min + 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      hitSlop={small ? { top: 4, bottom: 4 } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: small ? space.md : space.lg,
          borderRadius: radius.input,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: c.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Feather name={icon} size={small ? 15 : 18} color={fg} /> : null}
      <T variant={small ? 'metaStrong' : 'button'} style={{ color: fg }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color = 'text',
  size = 22,
  bg,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: ColorToken;
  size?: number;
  bg?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touch.min,
        height: touch.min,
        borderRadius: radius.input,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Feather name={icon} size={size} color={c[color]} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone = 'accent',
  large,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: 'accent' | 'danger';
  large?: boolean;
}) {
  const { c } = useTheme();
  const fg = selected ? (tone === 'danger' ? c.danger : c.accent) : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      // Drawn at 34 pt; the touch area still reaches 44 pt.
      hitSlop={large ? undefined : { top: 5, bottom: 5 }}
      style={({ pressed }) => ({
        minHeight: large ? touch.min : 34,
        paddingHorizontal: large ? space.lg : space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? fg : c.border,
        backgroundColor: selected ? (tone === 'danger' ? c.dangerSoft : c.accentSoft) : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.7 : 1,
      })}>
      {icon ? <Feather name={icon} size={14} color={fg} /> : null}
      <T variant={large ? 'bodyStrong' : 'metaStrong'} style={{ color: fg }}>
        {label}
      </T>
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surfaceAlt, borderRadius: radius.input, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: radius.input - 2,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
              backgroundColor: on ? c.surface : 'transparent',
              borderWidth: on ? 1 : 0,
              borderColor: c.border,
            }}>
            {/* Equal-width segments: grow like the system control does, then shrink to fit rather than truncate. */}
            <T variant="metaStrong" color={on ? 'text' : 'textMuted'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.5}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  strong,
  height = touch.min,
  indent = 0,
  muted,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  strong?: boolean;
  height?: number;
  indent?: number;
  muted?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => ({
        minHeight: height,
        paddingLeft: space.lg + indent,
        paddingRight: space.lg,
        paddingVertical: subtitle ? space.sm : 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: pressed ? c.surfaceAlt : 'transparent',
      })}>
      {left}
      <View style={{ flex: 1 }}>
        <T variant={strong ? 'bodyStrong' : 'body'} color={muted && !strong ? 'textMuted' : 'text'} numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T variant="meta" color="textMuted" numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

export function SectionHeader({
  title,
  collapsed,
  onToggle,
  right,
}: {
  title: string;
  collapsed?: boolean;
  onToggle?: () => void;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      disabled={!onToggle}
      accessibilityRole={onToggle ? 'button' : 'header'}
      accessibilityState={onToggle ? { expanded: !collapsed } : undefined}
      style={{
        minHeight: 40,
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
      }}>
      {onToggle ? <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={c.textMuted} /> : null}
      <T variant="label" color="textMuted" style={{ flex: 1 }}>
        {title}
      </T>
      {right}
    </Pressable>
  );
}

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

export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: c.border,
          overflow: 'hidden',
          flexDirection: accent ? 'row' : 'column',
        },
        accent ? null : { padding: space.md },
        style,
      ]}>
      {accent ? (
        <>
          <View style={{ width: 4, backgroundColor: accent }} />
          <View style={{ flex: 1, padding: space.md }}>{children}</View>
        </>
      ) : (
        children
      )}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.border, marginLeft: inset }} />;
}
