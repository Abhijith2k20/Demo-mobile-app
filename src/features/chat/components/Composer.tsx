import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '@/components/basics';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { useUi } from '@/stores/ui';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID, Message, User } from '@/types/models';
import { editMessage, extractMentions, sendMessage } from '../api';
import { pickPhotos } from '../photos';

export type FormKind = 'task' | 'issue' | 'report';

interface Props {
  channelId: ID;
  threadParentId?: ID;
  /** Project forms (task / issue / report) are offered only in project channels. */
  projectId: ID | null;
  canCreateTask: boolean;
  members: User[];
  placeholder: string;
  /** Thread only: label for "Also send to #channel". */
  alsoSendLabel?: string;
  editing: Message | null;
  onDoneEditing: () => void;
  onOpenForm: (kind: FormKind) => void;
}

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ width: '25%', alignItems: 'center', paddingVertical: space.md, gap: 6 }}>
      <View
        style={{
          width: touch.worker,
          height: touch.worker,
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
  const { channelId, threadParentId, projectId, members, editing } = props;
  const { c, type, worker } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const draftKey = threadParentId ? `thread:${threadParentId}` : `channel:${channelId}`;
  const draft = useUi((s) => s.drafts[draftKey] ?? '');
  const setDraft = useUi((s) => s.setDraft);
  const [plus, setPlus] = useState(false);
  const [alsoSend, setAlsoSend] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const inputRef = useRef<TextInput>(null);
  const text = draft;
  const hasText = text.trim().length > 0;

  // Editing loads the message text into the input.
  useEffect(() => {
    if (editing) {
      setDraft(draftKey, editing.body ?? '');
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  useEffect(() => {
    if (recording === null) return;
    const timer = setInterval(() => setRecording((s) => (s === null ? null : Math.min(59, s + 1))), 1000);
    return () => clearInterval(timer);
  }, [recording === null]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const sendVoice = () => {
    if (recording === null) return;
    sendMessage({ ...base, type: 'voice', body: null, data: extra({ durationSec: Math.max(1, recording) }) });
    setRecording(null);
  };

  const sendFile = () => {
    setPlus(false);
    sendMessage({ ...base, type: 'file', body: text.trim() || null, data: extra({ name: 'Site_measurements.pdf', sizeKb: 412 }) });
    setDraft(draftKey, '');
  };

  const openForm = (kind: FormKind) => {
    setPlus(false);
    props.onOpenForm(kind);
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
          <Pressable
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
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, minHeight: 32 }}>
          <Feather name={alsoSend ? 'check-square' : 'square'} size={18} color={alsoSend ? c.accent : c.textMuted} />
          <T variant="meta" color="textMuted">
            {props.alsoSendLabel}
          </T>
        </Pressable>
      ) : null}

      {recording !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm, minHeight: 56 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger }} />
          <T variant="bodyStrong" style={{ flex: 1 }}>
            {t('chat.recording', 'Recording…')} 0:{String(recording).padStart(2, '0')}
          </T>
          <Pressable hitSlop={10} onPress={() => setRecording(null)} style={{ paddingHorizontal: space.sm, minHeight: touch.min, justifyContent: 'center' }}>
            <T variant="metaStrong" color="textMuted">
              {t('common.cancel', 'Cancel')}
            </T>
          </Pressable>
          {round('send', t('chat.send', 'Send'), sendVoice, true)}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm }}>
          {editing ? null : round('plus', t('chat.more', 'More options'), () => setPlus(true), false)}
          {worker && !editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('plus.camera', 'Camera')}
              onPress={() => void sendPhotos('camera')}
              style={{
                width: touch.worker,
                height: touch.worker,
                borderRadius: radius.card,
                borderWidth: 2,
                borderColor: c.accent,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: space.xs,
              }}>
              <Feather name="camera" size={24} color={c.accent} />
            </Pressable>
          ) : null}
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
                minHeight: worker ? touch.worker : touch.min,
                maxHeight: 132,
              },
            ]}
          />
          {hasText || editing
            ? round(editing ? 'check' : 'send', editing ? t('common.save', 'Save') : t('chat.send', 'Send'), send, hasText)
            : round('mic', t('chat.voiceNote', 'Voice note'), () => setRecording(0), false)}
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
              setRecording(0);
            }}
          />
          <Tile icon="file-text" label={t('plus.file', 'File')} onPress={sendFile} />
          {projectId && props.canCreateTask ? <Tile icon="check-square" label={t('forms.newTask', 'New task')} onPress={() => openForm('task')} /> : null}
          {projectId ? <Tile icon="alert-triangle" label={t('forms.reportIssue', 'Report issue')} onPress={() => openForm('issue')} /> : null}
          {projectId ? <Tile icon="clipboard" label={t('forms.dailyReport', 'Daily report')} onPress={() => openForm('report')} /> : null}
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
