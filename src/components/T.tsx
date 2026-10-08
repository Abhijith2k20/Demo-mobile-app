import { Text, type TextProps } from 'react-native';
import type { ColorToken } from '@/theme/colors';
import type { TypeVariant } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

interface Props extends TextProps {
  variant?: TypeVariant;
  color?: ColorToken;
}

/** Themed text. Every piece of copy in the app goes through this. */
export function T({ variant = 'body', color = 'text', style, maxFontSizeMultiplier = 1.3, ...rest }: Props) {
  const { c, type } = useTheme();
  return <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[type[variant], { color: c[color] }, style]} {...rest} />;
}
