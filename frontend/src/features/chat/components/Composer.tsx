import { Feather } from '@expo/vector-icons';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, type IconName } from '@/components/basics';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { toast, useUi } from '@/stores/ui';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID, Message, User } from '@/types/models';
import { editMessage } from '../api';
import { extractMentions, isBotUser, pickPhotos, sendMessage, useMe } from '@/features/shared';

const MAX_VOICE_SECONDS = 120;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface Props {
  channelId: ID;
  threadParentId?: ID;
  members: User[];
  placeholder: string;
  /** Thread only: label for "Also send to #channel". */
  alsoSendLabel?: string;
  editing: Message | null;
  onDoneEditing: () => void;
}

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ width: '25%', alignItems: 'center', paddingVertical: space.md, gap: 6 }}>
      <View
        style={{
          width: touch.large,
          height: touch.large,
          borderRadius: radius.card,
          backgroundColor: c.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Feather name={icon} size={22} color={c.accent} />
      </View>
      <T variant="meta" style={{ textAlign: 'center' }} numberOfLines={2}>
        {label}
      </T>
    </Pressable>
  );
}

export function Composer(props: Props) {
  const { channelId, threadParentId, members, editing } = props;
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const draftKey = threadParentId ? `thread:${threadParentId}` : `channel:${channelId}`;
  const draft = useUi((s) => s.drafts[draftKey] ?? '');
  const setDraft = useUi((s) => s.setDraft);
  const [plus, setPlus] = useState(false);
  const [alsoSend, setAlsoSend] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  /** Seconds recorded, or null when not recording. */
  const recording = recorderState.isRecording ? Math.floor(recorderState.durationMillis / 1000) : null;
  const inputRef = useRef<TextInputInstance>(null);
  const text = draft;
  const hasText = text.trim().length > 0;
  const me = useMe();
  // "@" + letters at the end of the text opens the people list (extractMentions matches first names).
  // shortcut: only looks at the end of the text, not the cursor; enough for typing forward.
  const mentionQuery = /(?:^|\s)@(\p{L}*)$/u.exec(text)?.[1]?.toLowerCase();
  const mentionMatches =
    mentionQuery === undefined
      ? []
      : members
          .filter((u) => u.id !== me.id && u.isActive && u.email && !isBotUser(u) && u.name.toLowerCase().split(' ').some((w) => w.startsWith(mentionQuery)))
          .slice(0, 5);
  const pickMention = (u: User) => setDraft(draftKey, text.replace(/@\p{L}*$/u, `@${u.name.split(' ')[0]} `));

  // Editing loads the message text into the input.
  useEffect(() => {
    if (editing) {
      setDraft(draftKey, editing.body ?? '');
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const startRecording = async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
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

  const stopRecording = async (): Promise<string | null> => {
    await recorder.stop();
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    return recorder.uri;
  };

  const base = { channelId, threadParentId: threadParentId ?? null };
  const extra = (data: Record<string, unknown> | null): Record<string, unknown> | null =>
    threadParentId && alsoSend ? { ...(data ?? {}), alsoToChannel: true } : data;

  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      if (body !== editing.body) editMessage(editing, body);
      props.onDoneEditing();
    } else {
      const mentions = extractMentions(body, members);
      sendMessage({ ...base, type: 'text', body, data: extra(mentions.length ? { mentions } : null) });
    }
    setDraft(draftKey, '');
  };

  const sendPhotos = async (source: 'camera' | 'gallery') => {
    setPlus(false);
    const uris = await pickPhotos(source, 6);
    if (uris.length === 0) return;
    sendMessage({ ...base, type: 'image', body: text.trim() || null, data: extra(null), photoUris: uris });
    setDraft(draftKey, '');
  };

  const sendVoice = async () => {
    if (recording === null) return;
    const seconds = Math.max(1, recording);
    const uri = await stopRecording();
    if (!uri) return;
    sendMessage({ ...base, type: 'voice', body: null, data: extra({ durationSec: seconds }),
      file: { uri, kind: 'voice', name: 'voice-note.m4a', mime: 'audio/mp4' } });
  };

  const cancelVoice = () => void stopRecording();

  // Voice notes stop at two minutes (spec §5.3).
  useEffect(() => {
    if (recording !== null && recording >= MAX_VOICE_SECONDS) void sendVoice();
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendFile = async () => {
    setPlus(false);
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (res.canceled) return;
    const doc = res.assets[0];
    if ((doc.size ?? 0) > MAX_FILE_BYTES) {
      toast(t('chat.fileTooBig', 'Files must be under 25 MB.'), 'danger');
      return;
    }
    sendMessage({ ...base, type: 'file', body: text.trim() || null, data: extra({ name: doc.name, size: doc.size ?? null }),
      file: { uri: doc.uri, kind: 'file', name: doc.name, mime: doc.mimeType ?? 'application/pdf' } });
    setDraft(draftKey, '');
  };

  const round = (icon: IconName, label: string, onPress: () => void, active: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: touch.min,
        height: touch.min,
        borderRadius: touch.min / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? c.accent : 'transparent',
      }}>
      <Feather name={icon} size={20} color={active ? c.onAccent : c.textMuted} />
    </Pressable>
  );

  return (
    <View style={{ backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, space.sm) }}>
      {editing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <Feather name="edit-2" size={14} color={c.accent} />
          <T variant="metaStrong" color="accent" style={{ flex: 1 }}>
            {t('chat.editing', 'Editing message')}
          </T>
          <Pressable accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              setDraft(draftKey, '');
              props.onDoneEditing();
            }}>
            <T variant="metaStrong" color="textMuted">
              {t('common.cancel', 'Cancel')}
            </T>
          </Pressable>
        </View>
      ) : null}
      {props.alsoSendLabel && !editing ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: alsoSend }}
          onPress={() => setAlsoSend((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: touch.min }}>
          <Feather name={alsoSend ? 'check-square' : 'square'} size={18} color={alsoSend ? c.accent : c.textMuted} />
          <T variant="meta" color="textMuted">
            {props.alsoSendLabel}
          </T>
        </Pressable>
      ) : null}

      {mentionMatches.length && recording === null ? (
        <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: space.xs }}>
          {mentionMatches.map((u) => (
            <Pressable
              key={u.id}
              accessibilityRole="button"
              accessibilityLabel={t('chat.mentionPerson', 'Mention {{name}}', { name: u.name })}
              onPress={() => pickMention(u)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                minHeight: touch.min,
                backgroundColor: pressed ? c.surfaceAlt : 'transparent',
              })}>
              <Avatar id={u.id} name={u.name} size={28} />
              <T variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {u.name}
              </T>
            </Pressable>
          ))}
        </View>
      ) : null}
      {recording !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm, minHeight: 56 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger }} />
          <T variant="bodyStrong" style={{ flex: 1 }}>
            {t('chat.recording', 'Recording…')} {Math.floor(recording / 60)}:{String(recording % 60).padStart(2, '0')}
          </T>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={cancelVoice} style={{ paddingHorizontal: space.sm, minHeight: touch.min, justifyContent: 'center' }}>
            <T variant="metaStrong" color="textMuted">
              {t('common.cancel', 'Cancel')}
            </T>
          </Pressable>
          {round('send', t('chat.send', 'Send'), () => void sendVoice(), true)}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm }}>
          {editing ? null : round('plus', t('chat.more', 'More options'), () => setPlus(true), false)}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(v) => setDraft(draftKey, v)}
            placeholder={props.placeholder}
            placeholderTextColor={c.textFaint}
            multiline
            accessibilityLabel={props.placeholder}
            style={[
              type.body,
              {
                flex: 1,
                color: c.text,
                backgroundColor: c.surfaceAlt,
                borderRadius: 22,
                paddingHorizontal: space.lg,
                paddingTop: 10,
                paddingBottom: 10,
                minHeight: touch.min,
                maxHeight: 132,
              },
            ]}
          />
          {hasText || editing
            ? round(editing ? 'check' : 'send', editing ? t('common.save', 'Save') : t('chat.send', 'Send'), send, hasText)
            : round('mic', t('chat.voiceNote', 'Voice note'), () => void startRecording(), false)}
        </View>
      )}

      <Sheet visible={plus} onClose={() => setPlus(false)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Tile icon="camera" label={t('plus.camera', 'Camera')} onPress={() => void sendPhotos('camera')} />
          <Tile icon="image" label={t('plus.gallery', 'Gallery')} onPress={() => void sendPhotos('gallery')} />
          <Tile
            icon="mic"
            label={t('chat.voiceNote', 'Voice note')}
            onPress={() => {
              setPlus(false);
              void startRecording();
            }}
          />
          <Tile icon="file-text" label={t('plus.file', 'File')} onPress={() => void sendFile()} />
        </View>
      </Sheet>
    </View>
  );
}

export function ReadOnlyBar({ text }: { text: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: c.surfaceAlt,
        borderTopWidth: 1,
        borderTopColor: c.border,
        paddingTop: space.md,
        paddingBottom: Math.max(insets.bottom, space.md),
        paddingHorizontal: space.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
      }}>
      <Feather name="lock" size={14} color={c.textMuted} />
      <T variant="meta" color="textMuted">
        {text}
      </T>
    </View>
  );
}
