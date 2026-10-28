import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { photoTones } from '@/theme/colors';
import { radius } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';
import type { Attachment } from '@/types/models';
import { T } from './T';

/** One photo. Seeded "photos" are material-coloured tiles; real ones show the picture. */
export function PhotoTile({ photo, ratio = 1, more = 0, small }: { photo: Attachment; ratio?: number; more?: number; small?: boolean }) {
  const { c } = useTheme();
  const tone = photoTones[photo.tone ?? 'stone'];
  return (
    <View
      accessibilityLabel={photo.caption ?? 'Photo'}
      style={{
        flex: 1,
        aspectRatio: ratio, // reserved up front so nothing jumps when the image loads
        borderRadius: small ? 6 : radius.input,
        overflow: 'hidden',
        backgroundColor: photo.uri ? c.surfaceAlt : tone.bg,
      }}>
      {photo.uri ? (
        <Image source={{ uri: photo.uri }} style={{ flex: 1 }} contentFit="cover" transition={150} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="image" size={small ? 14 : 22} color={tone.ink} style={{ opacity: 0.55 }} />
        </View>
      )}
      {photo.caption && !small ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.scrim, paddingHorizontal: 8, paddingVertical: 4 }}>
          <T variant="meta" style={{ color: c.onColor, fontFamily: fonts.medium }} numberOfLines={1}>
            {photo.caption}
          </T>
        </View>
      ) : null}
      {more > 0 ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center' }}>
          <T variant="title" style={{ color: c.onColor }}>
            +{more}
          </T>
        </View>
      ) : null}
    </View>
  );
}

/** Site-log layout: 1 full width (4:3), 2 side by side, 3–4 in a 2 × 2 grid, more shows "+N". */
export function PhotoGrid({ photos }: { photos: Attachment[] }) {
  if (photos.length === 0) return null;
  const gap = 4;
  if (photos.length === 1) {
    return (
      <View style={{ flexDirection: 'row', maxWidth: 320 }}>
        <PhotoTile photo={photos[0]} ratio={4 / 3} />
      </View>
    );
  }
  if (photos.length === 2) {
    return (
      <View style={{ flexDirection: 'row', gap, maxWidth: 320 }}>
        <PhotoTile photo={photos[0]} />
        <PhotoTile photo={photos[1]} />
      </View>
    );
  }
  const shown = photos.slice(0, 4);
  const more = photos.length - shown.length;
  return (
    <View style={{ gap, maxWidth: 320 }}>
      <View style={{ flexDirection: 'row', gap }}>
        <PhotoTile photo={shown[0]} />
        <PhotoTile photo={shown[1]} />
      </View>
      <View style={{ flexDirection: 'row', gap }}>
        <PhotoTile photo={shown[2]} />
        {shown[3] ? <PhotoTile photo={shown[3]} more={more} /> : <View style={{ flex: 1 }} />}
      </View>
    </View>
  );
}
