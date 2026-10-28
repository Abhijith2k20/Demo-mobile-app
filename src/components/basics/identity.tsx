// Who and what: icon names, avatars, counts and labels.
import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import { avatarTone, stageColors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';
import { T } from '../T';

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

/** A stage name in its colour; `index` is the stage's position in the company's setup. */
export function StagePill({ index, label }: { index: number; label: string }) {
  const { c } = useTheme();
  const s = stageColors(c, index);
  // Wrapped so it centres in rows (the pill itself hugs the start of columns).
  return (
    <View>
      <Pill label={label} bg={s.bg} fg={s.fg} />
    </View>
  );
}
