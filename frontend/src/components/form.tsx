// Form pieces: Field (label + error), Input, Stepper.
import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { T } from './T';

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6, marginBottom: space.lg }}>
      <T variant="label" color="textMuted">
        {label}
      </T>
      {children}
      {error ? (
        <T variant="meta" color="danger" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function Input({ style, ...rest }: TextInputProps) {
  const { c, type } = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textFaint}
      style={[
        type.body,
        {
          color: c.text,
          backgroundColor: c.surfaceAlt,
          borderRadius: radius.input,
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          minHeight: 46,
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const { c } = useTheme();
  const btn = (icon: 'minus' | 'plus', next: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onChange(Math.max(min, Math.min(max, next)))}
      style={{
        width: touch.large,
        height: touch.large,
        borderRadius: radius.input,
        backgroundColor: c.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Feather name={icon} size={20} color={c.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
      {btn('minus', value - 1, 'Fewer')}
      <T variant="title" style={{ minWidth: 36, textAlign: 'center' }}>
        {value}
      </T>
      {btn('plus', value + 1, 'More')}
    </View>
  );
}
