// The form inside the channel sheet: name, public/private, and who is in it.
import { Feather } from '@expo/vector-icons';
import { Pressable, Switch, View } from 'react-native';
import { Avatar } from '@/components/basics';
import { Field } from '@/components/form';
import { SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel, ID } from '@/types/models';
import { useInEveryChannel, type MemberRow } from '../../../shared';

/** The one channel every project keeps: it cannot be renamed, made private or deleted. */
export const HOME_CHANNEL = 'general';

export interface ChannelDraft {
  /** null when creating a new channel. */
  channel: Channel | null;
  name: string;
  isPrivate: boolean;
  memberIds: ID[];
}

export function ChannelEditor({
  draft,
  members,
  onChange,
  error,
}: {
  draft: ChannelDraft;
  members: MemberRow[];
  onChange: (d: ChannelDraft) => void;
  error?: string;
}) {
  const { c } = useTheme();
  const inEveryChannel = useInEveryChannel();
  const home = draft.channel?.name === HOME_CHANNEL;
  const toggle = (id: ID) =>
    onChange({ ...draft, memberIds: draft.memberIds.includes(id) ? draft.memberIds.filter((x) => x !== id) : [...draft.memberIds, id] });

  return (
    <View style={{ gap: space.lg }}>
      <Field label="Name" error={error}>
        {home ? (
          <T variant="body" color="textMuted">
            # general — every project keeps this channel, so it can&apos;t be renamed.
          </T>
        ) : (
          <SheetInput
            value={draft.name}
            onChangeText={(v) => onChange({ ...draft, name: v.toLowerCase().replace(/\s+/g, '-') })}
            placeholder="e.g. suppliers"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
        )}
      </Field>

      <View style={{ marginTop: -space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.large }}>
          <Feather name={draft.isPrivate ? 'lock' : 'hash'} size={18} color={c.textMuted} />
          <T variant="bodyStrong" style={{ flex: 1 }}>
            Private channel
          </T>
          <Switch
            value={draft.isPrivate}
            disabled={home}
            onValueChange={(isPrivate) => onChange({ ...draft, isPrivate })}
            trackColor={{ true: c.accent, false: c.border }}
            thumbColor={c.surface}
            accessibilityLabel="Private channel"
          />
        </View>
        <T variant="meta" color="textMuted">
          {home
            ? '#general stays open to everyone on the project.'
            : draft.isPrivate
              ? 'Only the people ticked below can see this channel. Others cannot find or join it.'
              : 'Anyone on the project can find this channel and join it. The people ticked below are in it from the start.'}
        </T>
      </View>

      <View>
        <T variant="label" color="textMuted" style={{ marginBottom: space.xs }}>
          People in this channel
        </T>
        {members.map(({ user, member }) => {
          const manager = inEveryChannel(member.role);
          const on = manager || home || draft.memberIds.includes(user.id);
          const locked = manager || home;
          return (
            <Pressable
              key={user.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: locked }}
              disabled={locked}
              onPress={() => toggle(user.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
              <Feather name={on ? 'check-square' : 'square'} size={20} color={locked ? c.textFaint : on ? c.accent : c.textFaint} />
              <Avatar id={user.id} name={user.name} size={28} />
              <View style={{ flex: 1 }}>
                <T variant="body" numberOfLines={1}>
                  {user.name}
                </T>
                <T variant="meta" color="textMuted">
                  {manager ? 'Manager · in every channel' : member.jobTitle}
                </T>
              </View>
            </Pressable>
          );
        })}
        <T variant="meta" color="textFaint" style={{ marginTop: space.xs }}>
          The owner and admins can see every project channel.
        </T>
      </View>
    </View>
  );
}
