import { View } from 'react-native';
import { useTheme } from '@/theme/useTheme';
import { T } from './T';

/** Square company logo tile: initials on terracotta. */
export function CompanyTile({ size = 56 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="title" style={{ color: c.onAccent, fontSize: size * 0.38, lineHeight: size * 0.5 }} maxFontSizeMultiplier={1}>
        PI
      </T>
    </View>
  );
}
