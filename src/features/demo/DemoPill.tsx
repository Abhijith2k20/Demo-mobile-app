import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/components/T';
import { useUi } from '@/stores/ui';
import { motion, radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

const PILL_W = 104;

/** Small floating "Demo" pill: tap to open the Demo panel, drag to move, × to hide. */
export function DemoPill() {
  const { c } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const hidden = useUi((s) => s.demoPillHidden);
  const setUi = useUi((s) => s.set);
  const online = useUi((s) => s.online);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  // Sits above the tab bar and clear of composers and quick-add bars.
  const baseBottom = insets.bottom + 128;

  const open = () => router.push('/demo');
  const pan = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(width - PILL_W - space.md * 2, startX.value + e.translationX));
      y.value = Math.min(0, Math.max(-(height - baseBottom - insets.top - 60), startY.value + e.translationY));
    })
    .onEnd(() => {
      // Snap to the nearest side so it never sits in the middle of content.
      x.value = withTiming(x.value > (width - PILL_W) / 2 ? width - PILL_W - space.md * 2 : 0, { duration: motion.base });
    });
  const tap = Gesture.Tap().runOnJS(true).onEnd(open);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));

  if (hidden || pathname === '/demo') return null;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: space.md,
          bottom: baseBottom,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: c.header,
          borderWidth: 1,
          borderColor: c.headerField,
          borderRadius: radius.pill,
          shadowColor: c.shadow,
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 6,
          zIndex: 40,
        },
        style,
      ]}>
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <Animated.View
          accessibilityRole="button"
          accessibilityLabel="Open demo panel"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: space.md, paddingRight: space.sm, height: 36 }}>
          <Feather name="sliders" size={14} color={online ? c.onHeader : c.warning} />
          <T variant="metaStrong" style={{ color: c.onHeader }} maxFontSizeMultiplier={1.1}>
            Demo
          </T>
        </Animated.View>
      </GestureDetector>
      <Pressable
        accessibilityLabel="Hide demo pill"
        hitSlop={8}
        onPress={() => setUi({ demoPillHidden: true })}
        style={{ height: 36, paddingRight: space.md, paddingLeft: 2, justifyContent: 'center' }}>
        <Feather name="x" size={14} color={c.textFaint} />
      </Pressable>
    </Animated.View>
  );
}
