import { View } from 'react-native';
import { useTheme } from '@/theme/useTheme';
import { initials } from './basics/identity';
import { T } from './T';

/** Square company logo tile: the company's initials on the accent colour. */
export function CompanyTile({ name, size = 56 }: { name: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="title" style={{ color: c.onAccent, fontSize: size * 0.38, lineHeight: size * 0.5 }} maxFontSizeMultiplier={1}>
        {initials(name)}
      </T>
    </View>
  );
}
