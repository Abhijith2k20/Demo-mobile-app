// Bottom sheet used for menus, pickers and in-chat forms.
//
// Built on React Native's Modal + Reanimated + gesture-handler rather than @gorhom/bottom-sheet:
// that library mounts but never opens on Expo SDK 57 (see DECISIONS.md). Everything goes through
// this one component, so swapping the implementation later touches only this file.
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, TextInput, useWindowDimensions, View, type TextInputProps } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { T } from './T';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Tall sheet (forms, pickers with long lists). Otherwise the sheet hugs its content. */
  full?: boolean;
  children: ReactNode;
}

const DISMISS_DISTANCE = 90;

export function Sheet({ visible, onClose, title, subtitle, full, children }: Props) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Stay mounted a moment after closing so the sheet can slide away.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    progress.set(withTiming(visible ? 1 : 0, { duration: visible ? motion.base : motion.fast, easing: Easing.out(Easing.cubic) }));
    if (visible) {
      drag.set(0);
      return;
    }
    const timer = setTimeout(() => setMounted(false), motion.fast + 40);
    return () => clearTimeout(timer);
  }, [visible, progress, drag]);

  // Drag the handle down to dismiss.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      drag.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > 900) onClose();
      else drag.set(withTiming(0, { duration: motion.fast }));
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * height + drag.value }] }));
  const maxHeight = height - insets.top - space.lg;

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }, scrimStyle]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            style={[
              {
                backgroundColor: c.surface,
                borderTopLeftRadius: radius.sheet,
                borderTopRightRadius: radius.sheet,
                maxHeight,
                height: full ? Math.min(maxHeight, height * 0.88) : undefined,
                shadowColor: c.shadow,
                shadowOpacity: 0.18,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: -4 },
                elevation: 12,
              },
              sheetStyle,
            ]}>
            <GestureDetector gesture={pan}>
              <View style={{ alignItems: 'center', paddingTop: space.sm, paddingBottom: space.md }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.border }} />
              </View>
            </GestureDetector>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl }}>
              {title ? (
                <View style={{ marginBottom: space.md }}>
                  <T variant="heading">{title}</T>
                  {subtitle ? (
                    <T variant="meta" color="textMuted">
                      {subtitle}
                    </T>
                  ) : null}
                </View>
              ) : null}
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Text input styled for sheets. */
export function SheetInput({ style, ...rest }: TextInputProps) {
  const { c, type } = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textFaint}
      style={[
        type.body,
        {
          color: c.text,
          backgroundColor: c.surfaceAlt,
          borderRadius: radius.input,
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          minHeight: 46,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/** One tappable line in an action sheet. */
export { SheetAction } from './SheetAction';
