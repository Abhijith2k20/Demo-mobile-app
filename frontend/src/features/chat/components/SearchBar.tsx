// WhatsApp-style search: the header becomes a search field, the arrows step through matches in the chat.
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/basics';
import { T } from '@/components/T';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

interface Props {
  query: string;
  onChange: (q: string) => void;
  /** 0-based position in the results (0 = newest), and how many there are; total is null while there's nothing to show. */
  position: number;
  total: number | null;
  busy: boolean;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
}

export function SearchBar({ query, onChange, position, total, busy, onOlder, onNewer, onClose }: Props) {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const count = total ?? 0;
  return (
    <View style={{ backgroundColor: c.surface, paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, gap: space.xs }}>
        <IconButton icon="arrow-left" label={t('search.close', 'Close search')} onPress={onClose} />
        <TextInput
          value={query}
          onChangeText={onChange}
          placeholder={t('search.placeholder', 'Search messages')}
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          placeholderTextColor={c.textFaint}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={onOlder}
          accessibilityLabel={t('search.placeholder', 'Search messages')}
          style={[type.body, { flex: 1, color: c.text, backgroundColor: c.surfaceAlt, borderRadius: radius.input, paddingHorizontal: space.md, minHeight: 40 }]}
        />
        <View style={{ minWidth: 52, alignItems: 'center' }} accessibilityLiveRegion="polite">
          {busy ? (
            <ActivityIndicator size="small" color={c.textMuted} />
          ) : total === null ? null : (
            <T variant="meta" color="textMuted">
              {count ? t('search.position', '{{n}} of {{total}}', { n: position + 1, total: count }) : t('search.none', 'None')}
            </T>
          )}
        </View>
        <IconButton icon="chevron-up" label={t('search.older', 'Older match')} onPress={onOlder} color={position < count - 1 ? 'text' : 'textFaint'} />
        <IconButton icon="chevron-down" label={t('search.newer', 'Newer match')} onPress={onNewer} color={position > 0 ? 'text' : 'textFaint'} />
      </View>
    </View>
  );
}
