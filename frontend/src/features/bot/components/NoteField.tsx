// Optional note on a check-in: type it, or tap the microphone to record a voice note.
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import type { IconName } from '@/components/basics';
import { T } from '@/components/T';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';

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
  voiceSec: number | null;
}

export function NoteField({ value, onChange }: { value: NoteValue; onChange: (v: NoteValue) => void }) {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const [recording, setRecording] = useState<number | null>(null);
  const isRecording = recording !== null;

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setRecording((s) => (s === null ? null : Math.min(599, s + 1))), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

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
          <Pressable onPress={() => setRecording(null)} hitSlop={10} style={{ minHeight: touch.min, justifyContent: 'center' }}>
            <T variant="metaStrong" color="textMuted">
              {t('common.cancel', 'Cancel')}
            </T>
          </Pressable>
          {round(
            'square',
            t('checkin.stopRecording', 'Stop recording'),
            () => {
              onChange({ ...value, voiceSec: Math.max(1, recording ?? 1) });
              setRecording(null);
            },
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
          {round('mic', t('checkin.recordNote', 'Record a voice note'), () => setRecording(0))}
        </View>
      )}
      {value.voiceSec && !isRecording ? <VoiceChip seconds={value.voiceSec} onRemove={() => onChange({ ...value, voiceSec: null })} /> : null}
    </View>
  );
}
