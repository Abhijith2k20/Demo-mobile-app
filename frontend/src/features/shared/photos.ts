import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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
      return res.canceled ? [] : Promise.all(res.assets.map(shrink));
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsMultipleSelection: max > 1,
      selectionLimit: max,
    });
    return res.canceled ? [] : Promise.all(res.assets.slice(0, max).map(shrink));
  } catch (e) {
    console.warn('[photos]', e);
    toast(i18n.t('photos.failed', "Couldn't open photos. Try again."), 'danger');
    return [];
  }
}

const MAX_SIDE = 1600;

/** Photos go up at most 1600 px wide as JPEG, so they upload fast on site signal and stay under 10 MB. */
async function shrink(a: ImagePicker.ImagePickerAsset): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(a.uri);
    if (a.width > MAX_SIDE) context.resize({ width: MAX_SIDE, height: null });
    const image = await context.renderAsync();
    return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })).uri;
  } catch (e) {
    console.warn('[photos] not resized', e);
    return a.uri;
  }
}
