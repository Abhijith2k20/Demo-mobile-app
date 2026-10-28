import { Feather } from '@expo/vector-icons';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Avatar } from '@/components/basics';
import { T } from '@/components/T';
import { motion, radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Message } from '@/types/models';
import { toggleReaction } from '../api';
import { useChat } from '../context';

import type { ListItem } from '../hooks';
import { renderers, UnknownMessage } from './renderers';
import { isBotUser, useRoleLabels } from '@/features/shared';

const AVATAR = 36;

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
            hitSlop={{ top: 8, bottom: 8 }}
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
  const labels = useRoleLabels();
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
  const chip = bot
    ? t('chat.bot', 'Bot')
    : jobTitle
      ? labels.jobTitle(jobTitle)
      : sender && sender.companyRole !== 'member'
        ? labels.company(sender.companyRole)
        : null;

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
                <T variant="label" color="textFaint" style={{ letterSpacing: 0.4 }}>
                  {chip}
                </T>
              ) : null}
              <T variant="meta" color="textMuted">
                {format(parseISO(m.createdAt), 'h:mm a')}
              </T>
            </View>
          )}
          {body}
          {m.status === 'pending' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 }} accessibilityLabel={t('chat.sending', 'Sending…')}>
              <Feather name="clock" size={12} color={c.textFaint} />
              <T variant="meta" color="textFaint">
                {t('chat.sending', 'Sending…')}
              </T>
            </View>
          ) : m.status === 'failed' ? (
            <Pressable onPress={() => chat.onLongPress(m)} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 }}>
              <Feather name="alert-circle" size={12} color={c.danger} />
              <T variant="meta" color="danger">
                {t('chat.notSent', 'Not sent · tap for options')}
              </T>
            </Pressable>
          ) : null}
          {m.deletedAt ? null : <Reactions message={m} />}
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
