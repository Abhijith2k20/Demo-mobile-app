// The bot's check-in card (§8): big stacked buttons, no typing needed.
import { format, parseISO } from 'date-fns';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card, Chip, type IconName } from '@/components/basics';
import { T } from '@/components/T';
import { ISSUE_PRESETS } from '@/shared/schemas';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { CheckinAnswer, ID, Message } from '@/types/models';
import { pickPhotos } from '../chat/photos';
import { shortProjectName, useProject, useProjectAccess } from '../shared';
import { answerCheckin } from '../tasks/api';
import { useCheckin, useTask } from '../tasks/hooks';

type Step = 'ask' | 'progress' | 'problem' | 'done';

function BigButton({ label, onPress, tone, icon }: { label: string; onPress: () => void; tone?: 'plain' | 'accent'; icon?: IconName }) {
  const { c, type } = useTheme();
  const fg = tone === 'accent' ? c.accent : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.worker + 4,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: tone === 'accent' ? c.accent : c.border,
        backgroundColor: pressed ? c.surfaceAlt : tone === 'accent' ? c.accentSoft : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
      })}>
      {icon ? <Feather name={icon} size={18} color={tone === 'accent' ? c.accent : c.textMuted} /> : null}
      <T style={[type.button, { color: fg }]}>{label}</T>
    </Pressable>
  );
}

const REASONS = ISSUE_PRESETS.filter((p) => p !== 'Damage');

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
        height: 36,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: c.surfaceAlt,
      }}>
      <Feather name="mic" size={15} color={c.accent} />
      <T variant="metaStrong">
        {t('chat.voiceNote', 'Voice note')} · {clock(seconds)}
      </T>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={t('checkin.removeVoice', 'Remove voice note')}>
          <Feather name="x" size={15} color={c.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface NoteValue {
  text: string;
  voiceSec: number | null;
}

/** Notes for a check-in: type them, or tap the microphone to record a voice note (or both). */
function NoteField({ value, onChange }: { value: NoteValue; onChange: (v: NoteValue) => void }) {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const [recording, setRecording] = useState<number | null>(null);
  const isRecording = recording !== null;

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setRecording((s) => (s === null ? null : Math.min(599, s + 1))), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  const round = (icon: IconName, label: string, onPress: () => void, tone: 'plain' | 'danger') => (
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
        backgroundColor: tone === 'danger' ? c.danger : pressed ? c.border : c.surfaceAlt,
      })}>
      <Feather name={icon} size={18} color={tone === 'danger' ? c.onAccent : c.accent} />
    </Pressable>
  );

  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      <T variant="label" color="textMuted">
        {t('checkin.notes', 'Notes (optional)')}
      </T>
      {isRecording ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.min }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger }} />
          <T variant="bodyStrong" style={{ flex: 1 }}>
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
            'danger',
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
              type.body,
              {
                flex: 1,
                color: c.text,
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.input,
                paddingHorizontal: space.md,
                paddingTop: 10,
                paddingBottom: 10,
                minHeight: touch.min,
                maxHeight: 110,
              },
            ]}
          />
          {round('mic', t('checkin.recordNote', 'Record a voice note'), () => setRecording(0), 'plain')}
        </View>
      )}
      {value.voiceSec && !isRecording ? <VoiceChip seconds={value.voiceSec} onRemove={() => onChange({ ...value, voiceSec: null })} /> : null}
    </View>
  );
}

export function CheckinCard({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const checkin = useCheckin(message.data?.checkinId as ID | undefined);
  const { task } = useTask(message.data?.taskId as ID | undefined);
  const project = useProject(task?.projectId);
  const access = useProjectAccess(task?.projectId);
  const [step, setStep] = useState<Step>('ask');
  const [hasPhoto, setHasPhoto] = useState(false);
  const [note, setNote] = useState<NoteValue>({ text: '', voiceSec: null });
  const reminder = !!message.data?.reminder;

  if (!checkin) {
    return (
      <Card accent={c.accent} style={{ maxWidth: 360, marginTop: 2 }}>
        <T variant="meta" color="textMuted">
          {t('checkin.loading', 'Loading check-in…')}
        </T>
      </Card>
    );
  }

  const taskName = task?.name ?? t('checkin.yourTask', 'your task');
  const context = [project ? shortProjectName(project.name) : null, task ? t('checkin.due', 'due {{date}}', { date: format(parseISO(task.plannedFinish), 'EEE d MMM') }) : null]
    .filter(Boolean)
    .join(' · ');

  const submit = (answer: CheckinAnswer) =>
    answerCheckin(
      checkin,
      task,
      {
        ...answer,
        hasPhoto: hasPhoto || answer.hasPhoto,
        note: note.text.trim() || undefined,
        voiceSec: note.voiceSec ?? undefined,
      },
      access.isManager,
    );

  // Answered: collapse to a one-line summary, no buttons.
  if (checkin.answer) {
    const a = checkin.answer;
    const what =
      a.kind === 'progress'
        ? `${t('checkin.working', 'Working on it')} · ${a.percent}%`
        : a.kind === 'problem'
          ? `${t('checkin.problem', 'Problem')}${a.reason ? ` · ${t(`issue.preset.${a.reason}`, a.reason)}` : ''}`
          : a.kind === 'done'
            ? t('checkin.done', 'Done')
            : a.kind === 'not_started'
              ? t('checkin.notStarted', 'Not started')
              : t('checkin.started', 'Started');
    return (
      <Card accent={c.success} style={{ maxWidth: 360, marginTop: 2 }}>
        <T variant="meta" color="textMuted" numberOfLines={1}>
          {taskName}
        </T>
        <T variant="bodyStrong">
          {t('checkin.you', 'You')}: {what}
          {a.hasPhoto ? ` · ${t('checkin.withPhoto', 'photo attached')}` : ''}
          {a.at ? <T variant="meta" color="textMuted">{`  ·  ${format(parseISO(a.at), 'h:mm a')}`}</T> : null}
        </T>
        {a.note ? (
          <T variant="body" style={{ marginTop: 4 }}>
            {a.note}
          </T>
        ) : null}
        {a.voiceSec ? (
          <View style={{ marginTop: space.sm }}>
            <VoiceChip seconds={a.voiceSec} />
          </View>
        ) : null}
      </Card>
    );
  }

  // Archived projects are read-only, so there is nothing to answer.
  if (access.archived) {
    return (
      <Card accent={c.textFaint} style={{ maxWidth: 360, marginTop: 2 }}>
        <T variant="meta" color="textMuted" numberOfLines={1}>
          {taskName}
        </T>
        <T variant="body" color="textMuted">
          {t('chat.archived', 'This project is archived. It is read-only.')}
        </T>
      </Card>
    );
  }

  return (
    <Card accent={c.accent} style={{ maxWidth: 360, marginTop: 2 }}>
      {reminder ? (
        <T variant="label" color="warning" style={{ marginBottom: 4 }}>
          {t('checkin.reminder', 'Reminder')}
        </T>
      ) : null}
      <T variant="heading">
        {t('checkin.howIs', 'How is')} <T variant="heading" style={{ color: c.accent }}>{taskName}</T>?
      </T>
      {context ? (
        <T variant="meta" color="textMuted" style={{ marginBottom: space.md }}>
          {context}
        </T>
      ) : null}

      <NoteField value={note} onChange={setNote} />

      {step === 'ask' ? (
        <View style={{ gap: space.sm }}>
          <BigButton icon="check-circle" label={t('checkin.done', 'Done')} onPress={() => setStep('done')} />
          <BigButton icon="tool" label={t('checkin.working', 'Working on it')} onPress={() => setStep('progress')} />
          <BigButton icon="alert-octagon" label={t('checkin.problem', 'Problem')} onPress={() => setStep('problem')} />
          <BigButton icon="circle" label={t('checkin.notStarted', 'Not started')} onPress={() => submit({ kind: 'not_started' })} />
        </View>
      ) : null}

      {step === 'progress' ? (
        <View style={{ gap: space.md }}>
          <T variant="bodyStrong">{t('checkin.howMuch', 'How much is done?')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {[25, 50, 75, 90].map((p) => (
              <Chip key={p} large label={`${p}%`} onPress={() => submit({ kind: 'progress', percent: p })} />
            ))}
          </View>
          <BackLink onPress={() => setStep('ask')} />
        </View>
      ) : null}

      {step === 'problem' ? (
        <View style={{ gap: space.md }}>
          <T variant="bodyStrong">{t('checkin.whatProblem', "What's the problem?")}</T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Chip
              icon="camera"
              selected={hasPhoto}
              label={hasPhoto ? t('checkin.photoAdded', 'Photo added') : t('checkin.addPhoto', 'Add photo')}
              onPress={async () => {
                const uris = await pickPhotos('camera', 1);
                if (uris.length) setHasPhoto(true);
              }}
            />
          </View>
          <View style={{ gap: space.sm }}>
            {REASONS.map((r) => (
              <BigButton
                key={r}
                label={t(`issue.preset.${r}`, r)}
                onPress={() => submit({ kind: 'problem', reason: r })}
              />
            ))}
          </View>
          <BackLink onPress={() => setStep('ask')} />
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={{ gap: space.sm }}>
          <T variant="bodyStrong">{t('checkin.photoQuestion', 'Add a photo of the finished work?')}</T>
          <BigButton
            tone="accent"
            icon="camera"
            label={t('checkin.addPhoto', 'Add photo')}
            onPress={async () => {
              const uris = await pickPhotos('camera', 1);
              submit({ kind: 'done', hasPhoto: uris.length > 0 });
            }}
          />
          <BigButton label={t('checkin.skip', 'Skip')} onPress={() => submit({ kind: 'done' })} />
          <BackLink onPress={() => setStep('ask')} />
        </View>
      ) : null}
    </Card>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
      <T variant="metaStrong" color="textMuted">
        ← {t('common.back', 'Back')}
      </T>
    </Pressable>
  );
}
