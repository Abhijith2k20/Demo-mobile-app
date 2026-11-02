// The person's companies, to switch between (Home header and You).
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { CompanyTile } from '@/components/CompanyTile';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { switchCompany } from '@/lib/session';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/ui';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

export function CompanySwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const companies = useSession((s) => s.companies) ?? [];
  const current = useSession((s) => s.company?.id);
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (id: string) => {
    setBusy(id);
    try {
      await switchCompany(id);
      onClose();
      router.replace('/');
    } catch {
      toast(t('you.switchFailed', "Couldn't switch. Check your connection."), 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('you.switchCompany', 'Switch company')}>
      <View style={{ gap: space.sm }}>
        {companies.map((co) => (
          <Pressable
            key={co.id}
            accessibilityRole="button"
            accessibilityState={{ selected: co.id === current }}
            disabled={co.id === current || !!busy}
            onPress={() => void open(co.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: touch.min + 12,
              paddingHorizontal: space.md,
              borderRadius: radius.card,
              backgroundColor: co.id === current ? c.accentSoft : pressed ? c.surfaceAlt : c.surface,
            })}>
            <CompanyTile name={co.name} size={32} />
            <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {co.name}
            </T>
            {busy === co.id ? <ActivityIndicator color={c.accent} /> : co.id === current ? <Feather name="check" size={18} color={c.accent} /> : null}
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}
