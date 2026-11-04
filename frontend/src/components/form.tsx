// Form pieces: Field (label + error), Input.
import type { ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { radius, space } from '@/theme/spacing';
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
