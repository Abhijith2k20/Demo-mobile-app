// Pieces shared by the in-chat forms.
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Chip } from '@/components/basics';
import { PhotoTile } from '@/components/PhotoGrid';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { type ID } from '@/types/models';
import { pickPhotos } from '../../../shared';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  projectId: ID;
  channelId: ID;
}

/** Up to `max` photos: take or pick, shown as tiles with a remove button. */
export function PhotoPicker({ uris, onChange, max }: { uris: string[]; onChange: (next: string[]) => void; max: number }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const add = async (source: 'camera' | 'gallery') => {
    const picked = await pickPhotos(source, max - uris.length);
    if (picked.length) onChange([...uris, ...picked].slice(0, max));
  };
  return (
    <View style={{ gap: space.sm }}>
      {uris.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {uris.map((uri, i) => (
            <View key={uri} style={{ width: 72, height: 72 }}>
              <PhotoTile photo={{ id: uri, kind: 'image', uri, uploadId: null }} small />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('photos.remove', 'Remove photo')}
                hitSlop={11}
                onPress={() => onChange(uris.filter((_, j) => j !== i))}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: c.text,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Feather name="x" size={13} color={c.surface} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {uris.length < max ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip icon="camera" label={t('plus.camera', 'Camera')} onPress={() => void add('camera')} />
          <Chip icon="image" label={t('plus.gallery', 'Gallery')} onPress={() => void add('gallery')} />
        </View>
      ) : null}
    </View>
  );
}
