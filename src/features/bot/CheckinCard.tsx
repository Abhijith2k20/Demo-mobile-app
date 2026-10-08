// The bot's check-in card (§8): big stacked buttons, no typing needed.
import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Card, Chip } from '@/components/basics';
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

function BigButton({ label, onPress, tone }: { label: string; onPress: () => void; tone?: 'plain' | 'accent' }) {
  const { c, type } = useTheme();
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
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.md,
      })}>
      <T style={[type.button, { color: tone === 'accent' ? c.accent : c.text }]}>{label}</T>
    </Pressable>
  );
}

const REASONS = ISSUE_PRESETS.filter((p) => p !== 'Damage');

export function CheckinCard({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const checkin = useCheckin(message.data?.checkinId as ID | undefined);
  const { task } = useTask(message.data?.taskId as ID | undefined);
  const project = useProject(task?.projectId);
  const access = useProjectAccess(task?.projectId);
  const [step, setStep] = useState<Step>('ask');
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasVoice, setHasVoice] = useState(false);
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

  const submit = (answer: CheckinAnswer) => answerCheckin(checkin, task, { ...answer, hasPhoto: hasPhoto || answer.hasPhoto }, access.isManager);

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
          {a.hasPhoto ? ' 📷' : ''}
          {a.at ? <T variant="meta" color="textMuted">{`  ·  ${format(parseISO(a.at), 'h:mm a')}`}</T> : null}
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

      {step === 'ask' ? (
        <View style={{ gap: space.sm }}>
          <BigButton label={`✅  ${t('checkin.done', 'Done')}`} onPress={() => setStep('done')} />
          <BigButton label={`🔨  ${t('checkin.working', 'Working on it')}`} onPress={() => setStep('progress')} />
          <BigButton label={`⛔  ${t('checkin.problem', 'Problem')}`} onPress={() => setStep('problem')} />
          <BigButton label={t('checkin.notStarted', 'Not started')} onPress={() => submit({ kind: 'not_started' })} />
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
            <Chip
              icon="mic"
              selected={hasVoice}
              label={hasVoice ? t('checkin.voiceAdded', 'Voice note added') : t('chat.voiceNote', 'Voice note')}
              onPress={() => setHasVoice((v) => !v)}
            />
          </View>
          <View style={{ gap: space.sm }}>
            {REASONS.map((r) => (
              <BigButton
                key={r}
                label={t(`issue.preset.${r}`, r)}
                onPress={() => submit({ kind: 'problem', reason: r, note: hasVoice ? 'voice note attached' : undefined })}
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
            label={`📷  ${t('checkin.addPhoto', 'Add photo')}`}
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
