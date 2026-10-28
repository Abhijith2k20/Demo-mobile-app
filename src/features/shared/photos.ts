import * as ImagePicker from 'expo-image-picker';
import i18n from '@/lib/i18n';
import { toast } from '@/stores/ui';

/** Opens the camera or gallery and returns local file URIs (empty if cancelled or denied). */
export async function pickPhotos(source: 'camera' | 'gallery', max = 6): Promise<string[]> {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toast(i18n.t('photos.cameraDenied', 'Allow camera access in Settings to take photos.'), 'danger');
        return [];
      }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
      return res.canceled ? [] : res.assets.map((a) => a.uri);
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsMultipleSelection: max > 1,
      selectionLimit: max,
    });
    return res.canceled ? [] : res.assets.slice(0, max).map((a) => a.uri);
  } catch (e) {
    console.warn('[photos]', e);
    toast(i18n.t('photos.failed', "Couldn't open photos. Try again."), 'danger');
    return [];
  }
}
