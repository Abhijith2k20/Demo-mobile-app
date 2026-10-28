import { Feather } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { IconName } from './basics';
import { T } from './T';

export function SheetAction({
  icon,
  label,
  onPress,
  danger,
  hint,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  hint?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.large,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Feather name={icon} size={20} color={danger ? c.danger : c.textMuted} />
      <T variant="body" color={danger ? 'danger' : 'text'} style={{ flex: 1 }}>
        {label}
      </T>
      {hint ? (
        <T variant="meta" color="textFaint">
          {hint}
        </T>
      ) : null}
    </Pressable>
  );
}
