import type { TextStyle } from 'react-native';

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type TypeVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'meta'
  | 'metaStrong'
  | 'label'
  | 'button';

export function typography(worker: boolean): Record<TypeVariant, TextStyle> {
  const body = worker ? 17 : 16;
  return {
    display: { fontSize: 28, lineHeight: 34, fontFamily: fonts.bold },
    title: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold },
    heading: { fontSize: 17, lineHeight: 22, fontFamily: fonts.semibold },
    body: { fontSize: body, lineHeight: body + 7, fontFamily: fonts.regular },
    bodyStrong: { fontSize: body, lineHeight: body + 7, fontFamily: fonts.semibold },
    meta: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
    metaStrong: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },
    label: {
      fontSize: 12,
      lineHeight: 16,
      fontFamily: fonts.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    button: { fontSize: worker ? 18 : 16, lineHeight: worker ? 24 : 22, fontFamily: fonts.semibold },
  };
}
