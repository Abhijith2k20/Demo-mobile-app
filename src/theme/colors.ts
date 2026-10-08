import type { Stage } from '@/types/models';

export const light = {
  header: '#16262B',
  onHeader: '#F4EFE8',
  bg: '#FBF8F3',
  surface: '#FFFFFF',
  surfaceAlt: '#F2EDE5',
  border: '#E6DFD4',
  text: '#1B1F1E',
  textMuted: '#6B6F6C',
  textFaint: '#9A9C97',
  accent: '#C4622D',
  accentSoft: '#F7E6DB',
  success: '#2F7A4F',
  successSoft: '#E3F1E8',
  warning: '#B7791F',
  warningSoft: '#FBF0DC',
  danger: '#B3392F',
  dangerSoft: '#FBE7E5',
  info: '#2D6A8A',
  infoSoft: '#E2EFF6',
  execution: '#5B4BA8',
  executionSoft: '#E8E4F6',
  onAccent: '#FFFFFF',
  headerField: '#243A41',
  scrim: 'rgba(15, 26, 29, 0.45)',
  shadow: '#16262B',
};

export type Colors = typeof light;
export type ColorToken = keyof Colors;

export const dark: Colors = {
  header: '#0F1A1D',
  onHeader: '#E9E4DC',
  bg: '#121514',
  surface: '#1A1E1D',
  surfaceAlt: '#232827',
  border: '#2E3432',
  text: '#ECE8E1',
  textMuted: '#9EA29E',
  textFaint: '#6E726F',
  accent: '#E07A43',
  accentSoft: '#3A2418',
  success: '#5DB884',
  successSoft: '#173324',
  warning: '#E3A94A',
  warningSoft: '#3A2C12',
  danger: '#E5675C',
  dangerSoft: '#3C1A17',
  info: '#6BAED0',
  infoSoft: '#14293A',
  execution: '#A99BEA',
  executionSoft: '#2A2446',
  onAccent: '#FFFFFF',
  headerField: '#1B2A2E',
  scrim: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
};

// clay, sage, slate, ochre, plum, teal, sand, rust
export const avatarTones = [
  '#B5694A',
  '#6F8A6B',
  '#5C6F80',
  '#B48A3C',
  '#7D5A78',
  '#3F7F80',
  '#A08A66',
  '#9C4A33',
] as const;

export function avatarTone(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return avatarTones[h % avatarTones.length];
}

export type PhotoTone = 'plywood' | 'concrete' | 'tile' | 'sage';
export const photoTones: Record<PhotoTone, { bg: string; ink: string }> = {
  plywood: { bg: '#D9B98A', ink: '#5E4320' },
  concrete: { bg: '#A9A9A4', ink: '#3C3C39' },
  tile: { bg: '#E4E0D8', ink: '#57534A' },
  sage: { bg: '#A9B8A0', ink: '#39472F' },
};

export function stageColors(c: Colors, stage: Stage): { bg: string; fg: string } {
  switch (stage) {
    case 'design':
      return { bg: c.infoSoft, fg: c.info };
    case 'approval':
      return { bg: c.accentSoft, fg: c.accent };
    case 'procurement':
      return { bg: c.warningSoft, fg: c.warning };
    case 'execution':
      return { bg: c.executionSoft, fg: c.execution };
    case 'finishing':
      return { bg: c.successSoft, fg: c.success };
    case 'handover':
      return { bg: c.surfaceAlt, fg: c.textMuted };
  }
}
