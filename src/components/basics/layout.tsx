// Building blocks for lists and panels: rows, section headers, cards, dividers.
import { Feather } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { T } from '../T';

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
