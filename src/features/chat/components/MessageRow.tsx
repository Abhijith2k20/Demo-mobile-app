import { Feather } from '@expo/vector-icons';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Avatar } from '@/components/basics';
import { T } from '@/components/T';
import { motion, radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Message } from '@/types/models';
import { toggleReaction } from '../api';
import { isBotUser, useChat } from '../context';
import type { ListItem } from '../hooks';
import { renderers, UnknownMessage } from './renderers';

const AVATAR = 36;

/** Outbox status on own messages: clock (pending/sending), check (sent), red alert (failed). */
function StatusIcon({ status }: { status: Message['status'] }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const map = {
    pending: { icon: 'clock', color: c.info, label: t('chat.statusPending', 'Waiting to send') },
    sending: { icon: 'clock', color: c.info, label: t('chat.statusPending', 'Waiting to send') },
    sent: { icon: 'check', color: c.success, label: t('chat.statusSent', 'Sent') },
    failed: { icon: 'alert-circle', color: c.danger, label: t('chat.statusFailed', 'Not sent') },
  } as const;
  const s = map[status];
  return (
    <Animated.View key={s.icon} entering={FadeIn.duration(motion.fast)} accessibilityLabel={s.label}>
      <Feather name={s.icon} size={13} color={s.color} />
    </Animated.View>
  );
}

function Reactions({ message }: { message: Message }) {
  const { c } = useTheme();
  const { me } = useChat();
  const entries = Object.entries(message.reactions);
  if (entries.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(me.id);
        return (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`${emoji} ${ids.length}`}
            onPress={() => toggleReaction(message, emoji)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: space.sm,
              height: 28,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: mine ? c.accent : c.border,
              backgroundColor: mine ? c.accentSoft : c.surfaceAlt,
            }}>
            <T variant="meta">{emoji}</T>
            <T variant="metaStrong" color={mine ? 'accent' : 'textMuted'}>
              {ids.length}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

function MessageRowInner({ item }: { item: Extract<ListItem, { kind: 'message' }> }) {
  const { message: m, grouped, replies, lastReplyAt } = item;
  const { c } = useTheme();
  const { t } = useTranslation();
  const chat = useChat();
  const reduced = useReducedMotion();
  const sender = chat.users.get(m.senderId);
  const mine = m.senderId === chat.me.id;
  const bot = isBotUser(sender);
  const Renderer = renderers[m.type] ?? UnknownMessage;
  // Decided once, when the row first appears: only messages that just arrived animate in.
  const [arrivedNow] = useState(() => Date.now() - Date.parse(m.createdAt) < 2500);
  const fresh = !reduced && !mine && arrivedNow;

  if (m.type === 'system' && !m.deletedAt) {
    return (
      <View style={{ paddingHorizontal: space.xl, paddingVertical: space.sm }}>
        <Renderer message={m} />
      </View>
    );
  }

  // The bot conversation is one full-width column, so every card lines up on the same edges.
  if ((chat.isBotChat || m.type === 'checkin') && !m.deletedAt) {
    const card = m.type === 'checkin' || !!m.data?.kind;
    return (
      <View style={{ paddingHorizontal: space.lg, paddingVertical: 4 }}>
        {card ? (
          <Renderer message={m} />
        ) : (
          <View style={{ paddingHorizontal: space.md, paddingVertical: space.xs }}>
            <T variant="meta" color="textMuted" style={{ fontSize: 14, lineHeight: 20 }}>
              {m.body}
            </T>
          </View>
        )}
      </View>
    );
  }

  const jobTitle = chat.jobTitles.get(m.senderId);
  const chip = bot ? t('chat.bot', 'Bot') : (jobTitle ?? (sender?.companyRole === 'owner' ? 'Owner' : sender?.companyRole === 'admin' ? 'Admin' : null));

  const body = m.deletedAt ? (
    <T variant="body" color="textFaint" style={{ fontStyle: 'italic' }}>
      {t('chat.deleted', 'This message was deleted')}
    </T>
  ) : (
    <Renderer message={m} />
  );

  return (
    <Animated.View entering={fresh ? FadeInDown.duration(motion.base).withInitialValues({ transform: [{ translateY: 8 }] }) : undefined}>
      <Pressable
        onLongPress={() => !m.deletedAt && chat.onLongPress(m)}
        delayLongPress={280}
        style={({ pressed }) => ({
          flexDirection: 'row',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingTop: grouped ? 2 : space.sm + 2,
          paddingBottom: 2,
          backgroundColor: pressed ? c.surfaceAlt : 'transparent',
        })}>
        <View style={{ width: AVATAR }}>
          {grouped ? null : <Avatar id={m.senderId} name={sender?.name ?? '?'} size={AVATAR} bot={bot} />}
        </View>
        <View style={{ flex: 1 }}>
          {grouped ? null : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <T variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {sender?.name ?? t('chat.someone', 'Someone')}
              </T>
              {chip ? (
                <T variant="label" color="textFaint" style={{ fontSize: 10, letterSpacing: 0.4 }}>
                  {chip}
                </T>
              ) : null}
              <T variant="meta" color="textMuted">
                {format(parseISO(m.createdAt), 'h:mm a')}
              </T>
              {mine ? <StatusIcon status={m.status} /> : null}
            </View>
          )}
          {grouped && mine && m.status !== 'sent' ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              <View style={{ flex: 1 }}>{body}</View>
              <View style={{ paddingTop: 5 }}>
                <StatusIcon status={m.status} />
              </View>
            </View>
          ) : (
            body
          )}
          {m.deletedAt ? null : <Reactions message={m} />}
          {m.status === 'failed' ? (
            <Pressable onPress={() => chat.onLongPress(m)} hitSlop={8} style={{ paddingVertical: 4 }}>
              <T variant="meta" color="danger">
                {t('chat.failedHint', "Couldn't send. Tap for options.")}
              </T>
            </Pressable>
          ) : null}
          {replies > 0 && !chat.inThread ? (
            <Pressable onPress={() => chat.onOpenThread(m)} hitSlop={6} style={{ paddingVertical: 6, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Feather name="message-square" size={14} color={c.accent} />
              <T variant="metaStrong" color="accent">
                {replies === 1 ? t('chat.oneReply', '1 reply') : t('chat.replies', '{{count}} replies', { count: replies })}
              </T>
              {lastReplyAt ? (
                <T variant="meta" color="textMuted">
                  · {t('chat.lastReply', 'Last reply {{ago}} ago', { ago: formatDistanceToNowStrict(parseISO(lastReplyAt)) })}
                </T>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const MessageRow = memo(MessageRowInner);

export function DayDivider({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
      <T variant="label" color="textMuted">
        {label}
      </T>
      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
    </View>
  );
}

export function NewDivider() {
  const { c } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.accent }} />
      <T variant="label" color="accent">
        {t('chat.new', 'New')}
      </T>
    </View>
  );
}
