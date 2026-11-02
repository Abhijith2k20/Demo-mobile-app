// Optional note on a card answer: type it, or tap the microphone to record a voice note (up to 2 minutes).
import { Feather } from '@expo/vector-icons';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import type { IconName } from '@/components/basics';
import { T } from '@/components/T';
import { radius, space, touch } from '@/theme/spacing';
import { toast } from '@/stores/ui';
import { useTheme } from '@/theme/useTheme';

const MAX_VOICE_SECONDS = 120;

export const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** A voice note shown as a small chip: mic icon and length. */
export function VoiceChip({ seconds, onRemove }: { seconds: number; onRemove?: () => void }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: space.sm,
        height: 32,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: c.surfaceAlt,
      }}>
      <Feather name="mic" size={14} color={c.accent} />
      <T variant="metaStrong">
        {t('chat.voiceNote', 'Voice note')} · {clock(seconds)}
      </T>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={15} accessibilityRole="button" accessibilityLabel={t('checkin.removeVoice', 'Remove voice note')}>
          <Feather name="x" size={14} color={c.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface NoteValue {
  text: string;
  voice: { uri: string; seconds: number } | null;
}

export function NoteField({ value, onChange, voice }: { value: NoteValue; onChange: (v: NoteValue) => void; voice: boolean }) {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const recording = state.isRecording ? Math.floor(state.durationMillis / 1000) : null;
  const isRecording = recording !== null;

  const start = async () => {
    try {
      if (!(await requestRecordingPermissionsAsync()).granted) {
        toast(t('chat.micDenied', 'Allow microphone access in Settings to record voice notes.'), 'danger');
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      console.warn('[voice]', e);
      toast(t('chat.recordFailed', "Couldn't start recording."), 'danger');
    }
  };

  const stop = async (keep: boolean) => {
    const seconds = Math.max(1, recording ?? 1);
    await recorder.stop();
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    if (keep && recorder.uri) onChange({ ...value, voice: { uri: recorder.uri, seconds } });
  };

  useEffect(() => {
    if (recording !== null && recording >= MAX_VOICE_SECONDS) void stop(true);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const round = (icon: IconName, label: string, onPress: () => void, danger?: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touch.min,
        height: touch.min,
        borderRadius: touch.min / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: danger ? c.danger : pressed ? c.border : c.surfaceAlt,
      })}>
      <Feather name={icon} size={17} color={danger ? c.onAccent : c.accent} />
    </Pressable>
  );

  return (
    <View style={{ gap: space.sm }}>
      {isRecording ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.min }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} />
          <T variant="metaStrong" style={{ flex: 1 }}>
            {t('chat.recording', 'Recording…')} {clock(recording ?? 0)}
          </T>
          <Pressable onPress={() => void stop(false)} hitSlop={10} style={{ minHeight: touch.min, justifyContent: 'center' }}>
            <T variant="metaStrong" color="textMuted">
              {t('common.cancel', 'Cancel')}
            </T>
          </Pressable>
          {round(
            'square',
            t('checkin.stopRecording', 'Stop recording'),
            () => void stop(true),
            true,
          )}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <TextInput
            value={value.text}
            onChangeText={(text) => onChange({ ...value, text })}
            placeholder={t('checkin.notePlaceholder', 'Type a note, or record one')}
            placeholderTextColor={c.textFaint}
            multiline
            maxLength={500}
            accessibilityLabel={t('checkin.notes', 'Notes (optional)')}
            style={[
              type.meta,
              {
                flex: 1,
                fontSize: 15,
                lineHeight: 20,
                color: c.text,
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.input,
                paddingHorizontal: space.md,
                paddingTop: 11,
                paddingBottom: 11,
                minHeight: touch.min,
                maxHeight: 96,
              },
            ]}
          />
          {voice ? round('mic', t('checkin.recordNote', 'Record a voice note'), () => void start()) : null}
        </View>
      )}
      {value.voice && !isRecording ? <VoiceChip seconds={value.voice.seconds} onRemove={() => onChange({ ...value, voice: null })} /> : null}
    </View>
  );
}
