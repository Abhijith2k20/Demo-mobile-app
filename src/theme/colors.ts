import type { Stage } from '@/types/models';

// Neutral palette in the style of mainstream work-chat apps: white (light) or charcoal (dark)
// surfaces, grey hairlines, near-black text and one blue accent. Status colours stay muted:
// colour should signal state, not decorate. See DECISIONS.md.
export const light = {
  header: '#1B2430',
  onHeader: '#FFFFFF',
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F4F5F6',
  border: '#E2E4E7',
  text: '#1D1C1D',
  textMuted: '#616061',
  textFaint: '#9A9B9E',
  accent: '#1667B0',
  accentSoft: '#E8F1F9',
  success: '#2E7D5B',
  successSoft: '#E6F2EC',
  warning: '#9A6B15',
  warningSoft: '#FBF2DE',
  danger: '#B8423A',
  dangerSoft: '#FBEAE8',
  info: '#2F6F99',
  infoSoft: '#E6F0F6',
  execution: '#5E55A6',
  executionSoft: '#ECEAF6',
  onAccent: '#FFFFFF',
  headerField: '#2A3442',
  scrim: 'rgba(0, 0, 0, 0.4)',
  shadow: '#000000',
};

export type Colors = typeof light;
export type ColorToken = keyof Colors;

export const dark: Colors = {
  header: '#121417',
  onHeader: '#F2F3F4',
  bg: '#1A1D21',
  surface: '#222529',
  surfaceAlt: '#2C2F33',
  border: '#35373B',
  text: '#D1D2D3',
  textMuted: '#A3A5A8',
  textFaint: '#6F7174',
  accent: '#4A9FE0',
  accentSoft: '#1B2E40',
  success: '#5FB58C',
  successSoft: '#1B2F26',
  warning: '#D6A64F',
  warningSoft: '#332A17',
  danger: '#E0736A',
  dangerSoft: '#38201E',
  info: '#6FA9CC',
  infoSoft: '#1A2A35',
  execution: '#A39BDD',
  executionSoft: '#28253D',
  onAccent: '#FFFFFF',
  headerField: '#22262B',
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
