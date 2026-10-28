// Message renderer registry (§7.4): one component per message type.
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Avatar, Card, Pill } from '@/components/basics';
import { PhotoGrid } from '@/components/PhotoGrid';
import { T } from '@/components/T';
import { shortDate } from '@/lib/format';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Attachment, CheckinAnswer, ID, Message, MessageType } from '@/types/models';
import { CheckinCard } from '../../bot/components/CheckinCard';
import { VoiceChip } from '../../bot/components/NoteField';
import { MorningSummary } from '../../bot/components/MorningSummary';
import { firstName, useProblemTypes } from '../../shared';
import { useTask } from '../../tasks/hooks';
import { StatusDot, useStatusLabel } from '../../tasks/components/TaskIndicators';
import { useChat } from '../context';

type Props = { message: Message };

/** Body text with @mentions highlighted. */
export function RichText({ text }: { text: string }) {
  const { c } = useTheme();
  const { mentionNames, me } = useChat();
  const parts = text.split(/(@[\p{L}]+)/gu);
  return (
    <T variant="body" selectable={false}>
      {parts.map((p, i) => {
        if (p.startsWith('@') && mentionNames.has(p.slice(1).toLowerCase())) {
          const mine = firstName(me.name).toLowerCase() === p.slice(1).toLowerCase();
          return (
            <T key={i} variant="bodyStrong" style={{ color: c.accent, backgroundColor: mine ? c.accentSoft : undefined }}>
              {p}
            </T>
          );
        }
        return p;
      })}
    </T>
  );
}

function Edited({ message }: Props) {
  const { t } = useTranslation();
  if (!message.data?.edited) return null;
  return (
    <T variant="meta" color="textFaint">
      {t('chat.edited', '(edited)')}
    </T>
  );
}

function TextMessage({ message }: Props) {
  const kind = message.data?.kind;
  if (kind === 'morning_summary' || kind === 'no_open_tasks' || kind === 'checkin_intro') return <MorningSummary message={message} />;
  return (
    <View>
      <RichText text={message.body ?? ''} />
      <Edited message={message} />
    </View>
  );
}

function ImageMessage({ message }: Props) {
  const photos = (message.data?.attachments as Attachment[] | undefined) ?? [];
  return (
    <View style={{ gap: 6 }}>
      {message.body ? <RichText text={message.body} /> : null}
      <PhotoGrid photos={photos} />
    </View>
  );
}

const BARS = [6, 12, 18, 10, 16, 22, 14, 8, 18, 12, 20, 9, 15, 11, 19, 7, 13, 17, 10, 6];

function VoiceMessage({ message }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const sec = Number(message.data?.durationSec ?? 0);
  return (
    <View
      accessibilityLabel={t('chat.voiceNote', 'Voice note')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: c.surfaceAlt,
        borderRadius: radius.card,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        alignSelf: 'flex-start',
        marginTop: 2,
      }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="play" size={15} color={c.onAccent} style={{ marginLeft: 2 }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {BARS.map((h, i) => (
          <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: c.textFaint }} />
        ))}
      </View>
      <T variant="meta" color="textMuted">
        0:{String(sec).padStart(2, '0')}
      </T>
    </View>
  );
}

function FileMessage({ message }: Props) {
  const { c } = useTheme();
  const name = String(message.data?.name ?? 'File');
  const kb = Number(message.data?.sizeKb ?? 0);
  return (
    <View style={{ gap: 6 }}>
      {message.body ? <RichText text={message.body} /> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          borderRadius: radius.card,
          padding: space.md,
          maxWidth: 320,
        }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.avatar, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="file-text" size={20} color={c.danger} />
        </View>
        <View style={{ flex: 1 }}>
          <T variant="bodyStrong" numberOfLines={1}>
            {name}
          </T>
          <T variant="meta" color="textMuted">
            PDF · {kb >= 1000 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}
          </T>
        </View>
      </View>
    </View>
  );
}

function CardTitle({ icon, label, color }: { icon: keyof typeof Feather.glyphMap; label: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <Feather name={icon} size={13} color={color} />
      <T variant="label" style={{ color }}>
        {label}
      </T>
    </View>
  );
}

function TaskCard({ message }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const { users } = useChat();
  const statusLabel = useStatusLabel();
  const { task, loading } = useTask(message.data?.taskId as ID | undefined);
  if (!task) {
    return (
      <Card accent={c.info} style={{ maxWidth: 340, marginTop: 2 }}>
        <T variant="meta" color="textMuted">
          {loading ? '…' : t('task.unavailable', 'This task is no longer available.')}
        </T>
      </Card>
    );
  }
  const owner = task.ownerId ? users.get(task.ownerId) : undefined;
  return (
    <Pressable onPress={() => router.push(`/task/${task.id}`)} accessibilityRole="button" style={{ maxWidth: 340, marginTop: 2 }}>
      <Card accent={c.info}>
        <CardTitle icon="check-square" label={t('task.card', 'Task')} color={c.info} />
        <T variant="heading">{task.name}</T>
        <T variant="meta" color="textMuted">
          {task.phase} · {shortDate(task.plannedStart)}–{shortDate(task.plannedFinish)}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
          <StatusDot status={task.status} />
          <T variant="metaStrong">{statusLabel(task.status)}</T>
          <T variant="meta" color="textMuted">
            · {task.percent}%
          </T>
          <View style={{ flex: 1 }} />
          {owner ? <Avatar id={owner.id} name={owner.name} size={20} /> : null}
          {owner ? (
            <T variant="meta" color="textMuted">
              {firstName(owner.name)}
            </T>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function IssueCard({ message }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const { users } = useChat();
  const d = message.data ?? {};
  const urgent = d.urgency === 'urgent';
  const photos = (d.attachments as Attachment[] | undefined) ?? [];
  const mentions = ((d.mentions as ID[] | undefined) ?? []).map((id) => users.get(id)).filter(Boolean);
  const what = useProblemTypes().label(String(d.what ?? ''));
  return (
    <Card accent={c.danger} style={{ maxWidth: 340, marginTop: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardTitle icon="alert-triangle" label={t('issue.card', 'Issue')} color={c.danger} />
        {urgent ? <Pill label={t('issue.urgent', 'Urgent')} bg={c.dangerSoft} fg={c.danger} /> : null}
      </View>
      <T variant="heading">{what}</T>
      {d.note ? <T variant="body">{String(d.note)}</T> : null}
      {d.taskName ? (
        <T variant="meta" color="textMuted" style={{ marginTop: 2 }}>
          {t('issue.relatedTask', 'Task')}: {String(d.taskName)}
        </T>
      ) : null}
      {photos.length ? (
        <View style={{ marginTop: space.sm }}>
          <PhotoGrid photos={photos} />
        </View>
      ) : null}
      {mentions.length ? (
        <T variant="meta" style={{ marginTop: space.sm, color: c.accent }}>
          {mentions.map((u) => `@${firstName(u?.name)}`).join(' ')}
        </T>
      ) : null}
    </Card>
  );
}

function ReportLine({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <View style={{ marginTop: space.sm }}>
      <T variant="label" color="textMuted">
        {label}
      </T>
      <T variant="body">{text}</T>
    </View>
  );
}

function DailyReportCard({ message }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const d = message.data ?? {};
  const photos = (d.attachments as Attachment[] | undefined) ?? [];
  return (
    <Card accent={c.success} style={{ maxWidth: 340, marginTop: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardTitle icon="clipboard" label={t('report.card', 'Daily report')} color={c.success} />
        <T variant="meta" color="textMuted">
          {format(parseISO(message.createdAt), 'd MMM')}
        </T>
      </View>
      <T variant="body">{String(d.workDone ?? '')}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm }}>
        <Feather name="users" size={14} color={c.textMuted} />
        <T variant="metaStrong">{t('report.workersCount', '{{count}} people working', { count: Number(d.workers ?? 0) })}</T>
      </View>
      <ReportLine label={t('report.problems', 'Problems')} text={String(d.problems ?? '')} />
      <ReportLine label={t('report.tomorrow', "Tomorrow's plan")} text={String(d.tomorrow ?? '')} />
      {photos.length ? (
        <View style={{ marginTop: space.sm }}>
          <PhotoGrid photos={photos} />
        </View>
      ) : null}
    </Card>
  );
}

export function answerSummary(
  a: CheckinAnswer | undefined,
  t: (k: string, d: string, o?: Record<string, unknown>) => string,
  problemLabel: (key: string) => string,
): string {
  if (!a) return '';
  if (a.kind === 'progress') return `${a.percent}%`;
  if (a.kind === 'problem') return `${t('checkin.problem', 'Problem')}${a.reason ? ` · ${problemLabel(a.reason)}` : ''}`;
  if (a.kind === 'done') return t('checkin.done', 'Done');
  if (a.kind === 'not_started') return t('checkin.notStarted', 'Not started');
  return t('checkin.started', 'Started');
}

function StatusCard({ message }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const problems = useProblemTypes();
  const { users } = useChat();
  const d = message.data ?? {};
  const user = users.get(d.userId as ID);
  const escalation = d.kind === 'escalation';
  const answer = d.answer as CheckinAnswer | undefined;
  const tone = escalation ? c.warning : c.accent;
  return (
    <Pressable onPress={() => d.taskId && router.push(`/task/${String(d.taskId)}`)} style={{ maxWidth: 340, marginTop: 2 }}>
      <Card accent={tone}>
        <CardTitle
          icon={escalation ? 'bell' : 'activity'}
          label={escalation ? t('status.noUpdate', 'No update yet') : t('status.update', 'Check-in update')}
          color={tone}
        />
        {escalation ? (
          <T variant="body">
            {t('status.escalation', "{{name}} hasn't updated {{task}}.", { name: firstName(user?.name), task: String(d.taskName ?? '') })}
          </T>
        ) : (
          <T variant="body">
            <T variant="bodyStrong">{firstName(user?.name)}</T> · {String(d.taskName ?? '')} →{' '}
            <T variant="bodyStrong">{answerSummary(d.answer as CheckinAnswer | undefined, t as never, problems.label)}</T>
            {d.hasPhoto ? ` · ${t('checkin.withPhoto', 'photo attached')}` : ''}
          </T>
        )}
        {!escalation && answer?.note ? (
          <T variant="body" color="textMuted" style={{ marginTop: 4 }}>
            “{answer.note}”
          </T>
        ) : null}
        {!escalation && answer?.voiceSec ? (
          <View style={{ marginTop: space.sm }}>
            <VoiceChip seconds={answer.voiceSec} />
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

function SystemNotice({ message }: Props) {
  return (
    <T variant="meta" color="textMuted" style={{ textAlign: 'center' }}>
      {message.body}
    </T>
  );
}

export function UnknownMessage() {
  const { t } = useTranslation();
  return (
    <T variant="meta" color="textFaint" style={{ fontStyle: 'italic' }}>
      {t('chat.unknownType', 'Update the app to see this message.')}
    </T>
  );
}

export const renderers: Record<MessageType, ComponentType<{ message: Message }>> = {
  text: TextMessage,
  image: ImageMessage,
  voice: VoiceMessage,
  file: FileMessage,
  task_card: TaskCard,
  checkin: CheckinCard,
  issue_card: IssueCard,
  daily_report: DailyReportCard,
  status_card: StatusCard,
  system: SystemNotice,
};

