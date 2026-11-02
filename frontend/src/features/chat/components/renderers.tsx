// Message renderer registry (§7.4): one component per message type.
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Card, Pill } from '@/components/basics';
import { PhotoGrid } from '@/components/PhotoGrid';
import { T } from '@/components/T';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Attachment, ChannelCard, ID, Message, MessageType, Tone } from '@/types/models';
import { CardView } from '../../bot/components/CardView';
import { firstName, useProblemTypes } from '../../shared';
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
  const uri = typeof message.data?.uri === 'string' ? message.data.uri : null;
  // Seeded and still-sending voice notes have no file yet: shown, but not playable.
  return uri ? <VoicePlayer uri={uri} seconds={Number(message.data?.durationSec ?? 0)} /> : <VoiceBubble seconds={Number(message.data?.durationSec ?? 0)} />;
}

function VoicePlayer({ uri, seconds }: { uri: string; seconds: number }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) void player.seekTo(0);
      player.play();
    }
  };
  return <VoiceBubble seconds={seconds} playing={status.playing} onPress={toggle} />;
}

function VoiceBubble({ seconds, playing, onPress }: { seconds: number; playing?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${t('chat.voiceNote', 'Voice note')}, ${seconds}s`}
      disabled={!onPress}
      onPress={onPress}
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
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: onPress ? c.accent : c.textFaint, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={playing ? 'pause' : 'play'} size={15} color={c.onAccent} style={{ marginLeft: playing ? 0 : 2 }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {BARS.map((h, i) => (
          <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: c.textFaint }} />
        ))}
      </View>
      <T variant="meta" color="textMuted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </T>
    </Pressable>
  );
}

function FileMessage({ message }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const name = String(message.data?.name ?? 'File');
  // Older messages store sizeKb; uploads store the size in bytes.
  const kb = message.data?.size ? Number(message.data.size) / 1024 : Number(message.data?.sizeKb ?? 0);
  const uri = typeof message.data?.uri === 'string' ? message.data.uri : null;
  const kind = /\.pdf$/i.test(name) ? 'PDF' : t('plus.file', 'File');
  return (
    <View style={{ gap: 6 }}>
      {message.body ? <RichText text={message.body} /> : null}
      <Pressable
        accessibilityRole={uri ? 'link' : undefined}
        accessibilityLabel={uri ? t('chat.openFile', 'Open {{name}}', { name }) : name}
        disabled={!uri}
        onPress={() => uri && void Linking.openURL(uri)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: pressed ? c.surfaceAlt : c.surface,
          borderRadius: radius.card,
          padding: space.md,
          maxWidth: 320,
        })}>
        <View style={{ width: 40, height: 40, borderRadius: radius.avatar, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="file-text" size={20} color={c.danger} />
        </View>
        <View style={{ flex: 1 }}>
          <T variant="bodyStrong" numberOfLines={1}>
            {name}
          </T>
          <T variant="meta" color="textMuted">
            {kind} · {kb >= 1000 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`}
          </T>
        </View>
        {uri ? <Feather name="external-link" size={16} color={c.textFaint} /> : null}
      </Pressable>
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

/** A card from the PM app: answerable in the person's bot conversation, or a status card in a project channel. */
function CardMessage({ message }: Props) {
  const { c } = useTheme();
  if (message.data?.cardId) return <CardView message={message} />;
  const card = (message.data?.content ?? { title: '' }) as ChannelCard;
  const tone = ({ info: c.info, success: c.success, warning: c.warning, danger: c.danger } as Record<Tone, string>)[card.tone ?? 'info'];
  const photos: Attachment[] = ((message.data?.photoUrls as string[] | undefined) ?? []).map((uri, i) => ({ id: `${message.id}-${i}`, kind: 'image', uri, uploadId: null }));
  return (
    <View style={{ maxWidth: 340, marginTop: 2 }}>
      <Card accent={tone}>
        <T variant="bodyStrong">{card.title}</T>
        {(card.lines ?? []).map((line, i) => (
          <T key={i} variant="body" color="textMuted" style={{ marginTop: 4 }}>
            {line}
          </T>
        ))}
        {photos.length ? (
          <View style={{ marginTop: space.sm }}>
            <PhotoGrid photos={photos} />
          </View>
        ) : null}
      </Card>
    </View>
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
  card: CardMessage,
  issue_card: IssueCard,
  daily_report: DailyReportCard,
  system: SystemNotice,
};

