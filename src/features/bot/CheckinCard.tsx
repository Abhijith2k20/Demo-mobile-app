// The bot's check-in card. Design rules (see DECISIONS.md):
//  - one question open at a time; the rest stay as one-line rows
//  - at most three main replies, short labels, one tap to answer
//  - details (how much, what problem, a note) only appear after the first tap
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import type { IconName } from '@/components/basics';
import { T } from '@/components/T';
import { ISSUE_PRESETS } from '@/shared/schemas';
import { todayIso } from '@/shared/taskRules';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { CheckinAnswer, ID, Message } from '@/types/models';
import { pickPhotos } from '../chat/photos';
import { shortProjectName, useProject, useProjectAccess } from '../shared';
import { answerCheckin } from '../tasks/api';
import { useCheckin, useTask } from '../tasks/hooks';
import { NoteField, VoiceChip, type NoteValue } from './NoteField';
import { useCheckinQueue } from './queue';

type Step = 'ask' | 'progress' | 'problem' | 'done';
type Tone = 'success' | 'info' | 'danger' | 'plain';

const REASONS = ISSUE_PRESETS.filter((p) => p !== 'Damage');

/** A reply the user can give with one tap. */
function Reply({ icon, label, tone, onPress }: { icon?: IconName; label: string; tone: Tone; onPress: () => void }) {
  const { c, worker } = useTheme();
  const fg = { success: c.success, info: c.info, danger: c.danger, plain: c.text }[tone];
  const bg = { success: c.successSoft, info: c.infoSoft, danger: c.dangerSoft, plain: c.surfaceAlt }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: worker ? touch.worker + 4 : touch.min,
        borderRadius: radius.input,
        backgroundColor: bg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: space.sm,
        opacity: pressed ? 0.65 : 1,
      })}>
      {icon ? <Feather name={icon} size={16} color={fg} /> : null}
      <T variant="metaStrong" style={{ color: fg, fontSize: worker ? 15 : 14 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
        {label}
      </T>
    </Pressable>
  );
}

/** Frame shared by every state of the card. */
function Shell({ children, tone, onPress }: { children: ReactNode; tone: 'open' | 'quiet'; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        backgroundColor: pressed ? c.surfaceAlt : c.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: tone === 'open' ? c.accent : c.border,
        paddingHorizontal: space.md,
        paddingVertical: tone === 'open' ? space.md : space.sm + 2,
      })}>
      {children}
    </Pressable>
  );
}

export function CheckinCard({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const checkinId = message.data?.checkinId as ID | undefined;
  const checkin = useCheckin(checkinId);
  const { task } = useTask(message.data?.taskId as ID | undefined);
  const project = useProject(task?.projectId);
  const access = useProjectAccess(task?.projectId);
  const queue = useCheckinQueue();
  const [step, setStep] = useState<Step>('ask');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<NoteValue>({ text: '', voiceSec: null });
  const reminder = !!message.data?.reminder;

  const taskName = task?.name ?? t('checkin.yourTask', 'your task');
  const overdue = !!task && task.plannedFinish < todayIso();
  const due = task ? format(parseISO(task.plannedFinish), 'EEE d MMM') : '';
  const where = [project ? shortProjectName(project.name) : null, task ? (overdue ? t('checkin.overdue', 'Overdue · {{date}}', { date: due }) : t('checkin.due', 'due {{date}}', { date: due })) : null]
    .filter(Boolean)
    .join(' · ');

  // A reminder repeats a question that already has its own card: keep it to one quiet line.
  if (reminder) {
    if (!checkin || checkin.answer) return null;
    return (
      <Pressable
        onPress={() => checkinId && queue?.open(checkinId)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, paddingHorizontal: space.xs }}>
        <Feather name="bell" size={13} color={c.warning} />
        <T variant="meta" color="warning" numberOfLines={1} style={{ flex: 1 }}>
          {t('checkin.reminderLine', 'Reminder: {{task}} still needs an update', { task: taskName })}
        </T>
      </Pressable>
    );
  }

  if (!checkin) {
    return (
      <Shell tone="quiet">
        <T variant="meta" color="textMuted">
          {t('checkin.loading', 'Loading check-in…')}
        </T>
      </Shell>
    );
  }

  // ---- Answered: one line ----
  if (checkin.answer) {
    const a = checkin.answer;
    const what =
      a.kind === 'progress'
        ? `${a.percent}%`
        : a.kind === 'problem'
          ? `${t('checkin.problem', 'Problem')}${a.reason ? ` · ${t(`issue.preset.${a.reason}`, a.reason)}` : ''}`
          : a.kind === 'done'
            ? t('checkin.done', 'Done')
            : a.kind === 'not_started'
              ? t('checkin.notStarted', 'Not started')
              : t('checkin.started', 'Started');
    const color = a.kind === 'problem' ? c.danger : a.kind === 'done' ? c.success : a.kind === 'not_started' ? c.textMuted : c.info;
    return (
      <Shell tone="quiet">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Feather name={a.kind === 'problem' ? 'alert-circle' : 'check-circle'} size={16} color={color} />
          <T variant="meta" color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
            {taskName}
          </T>
          <T variant="metaStrong" style={{ color }} numberOfLines={1}>
            {what}
          </T>
          {a.hasPhoto ? <Feather name="camera" size={13} color={c.textFaint} /> : null}
          {a.at ? (
            <T variant="meta" color="textFaint">
              {format(parseISO(a.at), 'h:mm a')}
            </T>
          ) : null}
        </View>
        {a.note ? (
          <T variant="meta" color="textMuted" style={{ marginTop: 4, marginLeft: 24 }}>
            “{a.note}”
          </T>
        ) : null}
        {a.voiceSec ? (
          <View style={{ marginTop: 6, marginLeft: 24 }}>
            <VoiceChip seconds={a.voiceSec} />
          </View>
        ) : null}
      </Shell>
    );
  }

  // ---- Archived project: nothing to answer ----
  if (access.archived) {
    return (
      <Shell tone="quiet">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Feather name="archive" size={15} color={c.textFaint} />
          <T variant="meta" color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
            {taskName}
          </T>
          <T variant="meta" color="textFaint">
            {t('checkin.archived', 'Archived')}
          </T>
        </View>
      </Shell>
    );
  }

  // ---- Waiting, but another card is open: one line, tap to open ----
  const active = !queue || queue.activeId === checkin.id;
  if (!active) {
    return (
      <Shell tone="quiet" onPress={() => queue?.open(checkin.id)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 4, backgroundColor: overdue ? c.danger : c.accent }} />
          <View style={{ flex: 1 }}>
            <T variant="metaStrong" numberOfLines={1}>
              {taskName}
            </T>
            <T variant="meta" color={overdue ? 'danger' : 'textMuted'} numberOfLines={1}>
              {where}
            </T>
          </View>
          <T variant="metaStrong" color="accent">
            {t('checkin.update', 'Update')}
          </T>
          <Feather name="chevron-down" size={16} color={c.accent} />
        </View>
      </Shell>
    );
  }

  // ---- The open card ----
  const submit = (answer: CheckinAnswer) =>
    answerCheckin(checkin, task, { ...answer, note: note.text.trim() || undefined, voiceSec: note.voiceSec ?? undefined }, access.isManager);
  const position = queue && queue.pending.length > 1 ? `${queue.pending.indexOf(checkin.id) + 1} / ${queue.pending.length}` : null;

  const substep = (question: string, body: ReactNode) => (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back', 'Back')} hitSlop={10} onPress={() => setStep('ask')} style={{ marginLeft: -4 }}>
          <Feather name="chevron-left" size={20} color={c.textMuted} />
        </Pressable>
        <T variant="metaStrong" style={{ flex: 1 }}>
          {question}
        </T>
      </View>
      {body}
    </View>
  );

  return (
    <Shell tone="open">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <T variant="bodyStrong" numberOfLines={2}>
            {taskName}
          </T>
          <T variant="meta" color={overdue ? 'danger' : 'textMuted'} numberOfLines={1}>
            {where}
          </T>
        </View>
        {position ? (
          <T variant="meta" color="textFaint">
            {position}
          </T>
        ) : null}
      </View>

      {task ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, marginBottom: space.md }}>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
            <View style={{ width: `${task.percent}%`, height: 4, borderRadius: 2, backgroundColor: task.status === 'blocked' ? c.danger : c.accent }} />
          </View>
          <T variant="meta" color="textMuted">
            {t('checkin.now', 'Now {{percent}}%', { percent: task.percent })}
          </T>
        </View>
      ) : (
        <View style={{ height: space.md }} />
      )}

      {step === 'ask' ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Reply icon="check" tone="success" label={t('checkin.done', 'Done')} onPress={() => setStep('done')} />
          <Reply icon="trending-up" tone="info" label={t('checkin.inProgress', 'In progress')} onPress={() => setStep('progress')} />
          <Reply icon="alert-circle" tone="danger" label={t('checkin.problem', 'Problem')} onPress={() => setStep('problem')} />
        </View>
      ) : null}

      {step === 'progress'
        ? substep(
            t('checkin.howMuch', 'How much is done?'),
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {[25, 50, 75, 90].map((p) => (
                <Reply key={p} tone={task && p <= task.percent ? 'plain' : 'info'} label={`${p}%`} onPress={() => submit({ kind: 'progress', percent: p })} />
              ))}
            </View>,
          )
        : null}

      {step === 'problem'
        ? substep(
            t('checkin.whatProblem', "What's the problem?"),
            <View style={{ gap: space.sm }}>
              {[REASONS.slice(0, 2), REASONS.slice(2)].map((pair, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
                  {pair.map((r) => (
                    <Reply key={r} tone="danger" label={t(`issue.preset.${r}`, r)} onPress={() => submit({ kind: 'problem', reason: r })} />
                  ))}
                </View>
              ))}
            </View>,
          )
        : null}

      {step === 'done'
        ? substep(
            t('checkin.confirmDone', 'Mark this task as done?'),
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Reply icon="check" tone="success" label={t('checkin.markDone', 'Mark done')} onPress={() => submit({ kind: 'done' })} />
              <Reply
                icon="camera"
                tone="plain"
                label={t('checkin.withPhotoButton', 'Done + photo')}
                onPress={async () => {
                  const uris = await pickPhotos('camera', 1);
                  submit({ kind: 'done', hasPhoto: uris.length > 0 });
                }}
              />
            </View>,
          )
        : null}

      {noteOpen ? (
        <View style={{ marginTop: space.md }}>
          <NoteField value={note} onChange={setNote} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, minHeight: 32 }}>
        {noteOpen ? null : (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setNoteOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="edit-3" size={14} color={c.textMuted} />
            <T variant="meta" color="textMuted">
              {t('checkin.addNote', 'Add a note')}
            </T>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        {step === 'ask' ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => submit({ kind: 'not_started' })}>
            <T variant="meta" color="textMuted">
              {t('checkin.notStartedYet', 'Not started yet')}
            </T>
          </Pressable>
        ) : null}
      </View>
    </Shell>
  );
}
