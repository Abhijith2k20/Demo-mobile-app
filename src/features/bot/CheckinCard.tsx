// The bot's check-in card. Design rules (see DECISIONS.md):
//  - one question open at a time; the rest stay as one-line rows
//  - progress is answered on a scale with a single tap; everything else is a quiet secondary action
//  - neutral surfaces: colour is used only for small state marks, never for whole buttons
//  - every state shares the same frame and the same left edge, so cards line up
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
import { useLargeText, useTheme } from '@/theme/useTheme';
import type { CheckinAnswer, ID, Message } from '@/types/models';
import { pickPhotos } from '../chat/photos';
import { shortProjectName, useProject, useProjectAccess } from '../shared';
import { answerCheckin } from '../tasks/api';
import { useCheckin, useTask } from '../tasks/hooks';
import { NoteField, VoiceChip, type NoteValue } from './NoteField';
import { useCheckinQueue } from './queue';

type Step = 'ask' | 'problem';
const STOPS = [25, 50, 75, 90, 100];
const REASONS = ISSUE_PRESETS.filter((p) => p !== 'Damage');

/** A neutral, outlined secondary action. */
function Quiet({ icon, label, onPress, active }: { icon?: IconName; label: string; onPress: () => void; active?: boolean }) {
  const { c, worker } = useTheme();
  const large = useLargeText();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: large ? undefined : 1,
        minHeight: worker ? touch.worker : touch.min,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: active ? c.textMuted : c.border,
        backgroundColor: pressed || active ? c.surfaceAlt : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: space.sm,
      })}>
      {icon ? <Feather name={icon} size={14} color={c.textMuted} /> : null}
      <T variant="metaStrong" numberOfLines={2} style={{ flexShrink: 1, textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}

/**
 * Progress scale: 25 · 50 · 75 · 90 · Done. The part already reached is shaded and underlined,
 * and tapping a stop answers the check-in in one go.
 */
function Scale({ current, onPick }: { current: number; onPick: (percent: number) => void }) {
  const { c, worker } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', minHeight: worker ? touch.worker + 4 : 46, borderRadius: radius.input, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
      {STOPS.map((p, i) => {
        const reached = p <= current;
        const label = p === 100 ? t('checkin.done', 'Done') : `${p}%`;
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={p === 100 ? label : t('checkin.setTo', 'Set progress to {{percent}}%', { percent: p })}
            onPress={() => onPick(p)}
            style={({ pressed }) => ({
              flex: p === 100 ? 1.25 : 1,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 4,
              borderLeftWidth: i ? 1 : 0,
              borderLeftColor: c.border,
              backgroundColor: pressed ? c.border : reached ? c.surfaceAlt : c.surface,
            })}>
            {p === 100 ? <Feather name="check" size={14} color={c.textMuted} /> : null}
            {/* Five fixed slots across the card: allow growth, but not past what fits a phone width. */}
            <T variant="metaStrong" color={reached ? 'textMuted' : 'text'} maxFontSizeMultiplier={1.6}>
              {label}
            </T>
            {reached ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: c.accent }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Frame shared by every state of the card. */
function Shell({ children, open, onPress }: { children: ReactNode; open?: boolean; onPress?: () => void }) {
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
        borderColor: open ? c.textFaint : c.border,
        padding: space.md,
      })}>
      {children}
    </Pressable>
  );
}

/** Small coloured dot + words: the only place state colour appears. */
function State({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <T variant="metaStrong" numberOfLines={1}>
        {text}
      </T>
    </View>
  );
}

export function CheckinCard({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  // At large text sizes: wrap instead of truncating, and stack the option buttons.
  const large = useLargeText();
  const lines = large ? 3 : 1;
  const optionRow = { flexDirection: large ? ('column' as const) : ('row' as const), gap: space.sm };
  const checkinId = message.data?.checkinId as ID | undefined;
  const checkin = useCheckin(checkinId);
  const { task } = useTask(message.data?.taskId as ID | undefined);
  const project = useProject(task?.projectId);
  const access = useProjectAccess(task?.projectId);
  const queue = useCheckinQueue();
  const [step, setStep] = useState<Step>('ask');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<NoteValue>({ text: '', voiceSec: null });
  const [hasPhoto, setHasPhoto] = useState(false);
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
      <Pressable onPress={() => checkinId && queue?.open(checkinId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, paddingHorizontal: space.md }}>
        <Feather name="bell" size={13} color={c.textMuted} />
        <T variant="meta" color="textMuted" numberOfLines={lines} style={{ flex: 1 }}>
          {t('checkin.reminderLine', 'Reminder: {{task}} still needs an update', { task: taskName })}
        </T>
      </Pressable>
    );
  }

  if (!checkin) {
    return (
      <Shell>
        <T variant="meta" color="textMuted">
          {t('checkin.loading', 'Loading check-in…')}
        </T>
      </Shell>
    );
  }

  /** Title and context line, identical in every state so the text always starts on the same edge. */
  const heading = (strong: boolean, right?: ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1 }}>
        <T variant={strong ? 'bodyStrong' : 'metaStrong'} numberOfLines={strong ? lines + 1 : lines} style={strong ? undefined : { fontSize: 14 }}>
          {taskName}
        </T>
        <T variant="meta" color={overdue && !checkin.answer ? 'danger' : 'textMuted'} numberOfLines={lines}>
          {where}
        </T>
      </View>
      {right}
    </View>
  );

  // ---- Answered ----
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
    const color = a.kind === 'problem' ? c.danger : a.kind === 'done' ? c.success : a.kind === 'not_started' ? c.textFaint : c.info;
    return (
      <Shell>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <T variant="meta" color="textMuted" numberOfLines={lines} style={{ flex: 1, fontSize: 14 }}>
            {taskName}
          </T>
          <State color={color} text={what} />
          {a.hasPhoto ? <Feather name="camera" size={13} color={c.textFaint} /> : null}
          {a.at ? (
            <T variant="meta" color="textFaint">
              {format(parseISO(a.at), 'h:mm a')}
            </T>
          ) : null}
        </View>
        {a.note ? (
          <T variant="meta" color="textMuted" style={{ marginTop: 4 }}>
            “{a.note}”
          </T>
        ) : null}
        {a.voiceSec ? (
          <View style={{ marginTop: 6 }}>
            <VoiceChip seconds={a.voiceSec} />
          </View>
        ) : null}
      </Shell>
    );
  }

  // ---- Archived project: nothing to answer ----
  if (access.archived) {
    return (
      <Shell>
        {heading(
          false,
          <T variant="meta" color="textFaint">
            {t('checkin.archived', 'Archived')}
          </T>,
        )}
      </Shell>
    );
  }

  // ---- Waiting, but another card is open: one row, tap to open ----
  const active = !queue || queue.activeId === checkin.id;
  if (!active) {
    return (
      <Shell onPress={() => queue?.open(checkin.id)}>
        {heading(
          false,
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <T variant="metaStrong" color="accent">
              {t('checkin.update', 'Update')}
            </T>
            <Feather name="chevron-down" size={16} color={c.accent} />
          </View>,
        )}
      </Shell>
    );
  }

  // ---- The open card ----
  const submit = (answer: CheckinAnswer) =>
    answerCheckin(checkin, task, { ...answer, hasPhoto: hasPhoto || undefined, note: note.text.trim() || undefined, voiceSec: note.voiceSec ?? undefined }, access.isManager);
  const position = queue && queue.pending.length > 1 ? `${queue.pending.indexOf(checkin.id) + 1} of ${queue.pending.length}` : null;
  const current = task?.percent ?? 0;

  return (
    <Shell open>
      {heading(
        true,
        position ? (
          <T variant="meta" color="textFaint" style={{ alignSelf: 'flex-start' }}>
            {position}
          </T>
        ) : undefined,
      )}

      {step === 'ask' ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <T variant="meta" color="textMuted" style={{ flex: 1 }}>
              {t('checkin.howFar', 'How far along is it?')}
            </T>
            <T variant="meta" color="textFaint">
              {task?.status === 'blocked' ? t('status.blocked', 'Blocked') : t('checkin.now', 'Now {{percent}}%', { percent: current })}
            </T>
          </View>
          <Scale current={current} onPick={(p) => submit(p === 100 ? { kind: 'done' } : { kind: 'progress', percent: p })} />
          <View style={optionRow}>
            <Quiet icon="alert-circle" label={t('checkin.problem', 'Problem')} onPress={() => setStep('problem')} />
            <Quiet icon="minus-circle" label={t('checkin.notStarted', 'Not started')} onPress={() => submit({ kind: 'not_started' })} />
            <Quiet icon="edit-3" label={t('checkin.note', 'Note')} active={noteOpen} onPress={() => setNoteOpen((v) => !v)} />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.back', 'Back')} hitSlop={10} onPress={() => setStep('ask')} style={{ marginLeft: -5 }}>
              <Feather name="chevron-left" size={18} color={c.textMuted} />
            </Pressable>
            <T variant="meta" color="textMuted" style={{ flex: 1 }}>
              {t('checkin.whatProblem', "What's the problem?")}
            </T>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setNoteOpen((v) => !v)}>
              <T variant="meta" color="textMuted">
                {noteOpen ? t('checkin.hideNote', 'Hide note') : t('checkin.addNote', 'Add a note')}
              </T>
            </Pressable>
          </View>
          {[REASONS.slice(0, 2), REASONS.slice(2)].map((pair, i) => (
            <View key={i} style={optionRow}>
              {pair.map((r) => (
                <Quiet key={r} label={t(`issue.preset.${r}`, r)} onPress={() => submit({ kind: 'problem', reason: r })} />
              ))}
            </View>
          ))}
        </View>
      )}

      {noteOpen ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <NoteField value={note} onChange={setNote} />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: hasPhoto }}
            hitSlop={6}
            onPress={async () => {
              if (hasPhoto) return setHasPhoto(false);
              const uris = await pickPhotos('camera', 1);
              if (uris.length) setHasPhoto(true);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
            <Feather name={hasPhoto ? 'check' : 'camera'} size={14} color={c.textMuted} />
            <T variant="meta" color="textMuted">
              {hasPhoto ? t('checkin.photoAdded', 'Photo added · tap to remove') : t('checkin.addPhoto', 'Add a photo')}
            </T>
          </Pressable>
          <T variant="meta" color="textFaint">
            {t('checkin.noteHint', 'Your note is sent with the answer you tap above.')}
          </T>
        </View>
      ) : null}
    </Shell>
  );
}
