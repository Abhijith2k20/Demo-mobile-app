// Things people tap: buttons, icon buttons, chips, segmented choices.
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { type ColorToken } from '@/theme/colors';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { T } from '../T';
import { type IconName } from './identity';

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
  const { c, simple } = useTheme();
  const bg = { primary: c.accent, secondary: c.surfaceAlt, ghost: 'transparent', danger: c.dangerSoft }[kind];
  const fg = { primary: c.onAccent, secondary: c.text, ghost: c.accent, danger: c.danger }[kind];
  const height = small ? 36 : simple ? touch.large + 4 : touch.min + 2;
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
