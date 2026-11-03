// The form inside the channel sheet: name, public/private, and who is in it.
import { Feather } from "@expo/vector-icons";
import { Pressable, Switch, View } from "react-native";
import { Avatar } from "@/components/basics";
import { Field } from "@/components/form";
import { SheetInput } from "@/components/Sheet";
import { T } from "@/components/T";
import i18n from "@/lib/i18n";
import { space, touch } from "@/theme/spacing";
import { useTheme } from "@/theme/useTheme";
import type { Channel, ID } from "@/types/models";
import type { MemberRow } from "../../../shared";

/** The one channel every project keeps: it cannot be renamed, made private or deleted. */
export const HOME_CHANNEL = "general";

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
  const home = draft.channel?.name === HOME_CHANNEL;
  const toggle = (id: ID) =>
    onChange({
      ...draft,
      memberIds: draft.memberIds.includes(id)
        ? draft.memberIds.filter((x) => x !== id)
        : [...draft.memberIds, id],
    });

  return (
    <View style={{ gap: space.lg }}>
      <Field label="Name" error={error}>
        {home ? (
          <T variant="body" color="textMuted">
            # general — every project keeps this channel, so it can&apos;t be
            renamed.
          </T>
        ) : (
          <SheetInput
            value={draft.name}
            onChangeText={(v) =>
              onChange({ ...draft, name: v.toLowerCase().replace(/\s+/g, "-") })
            }
            placeholder="e.g. suppliers"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
        )}
      </Field>

      <View style={{ marginTop: -space.lg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            minHeight: touch.large,
          }}
        >
          <Feather
            name={draft.isPrivate ? "lock" : "hash"}
            size={18}
            color={c.textMuted}
          />
          <T variant="bodyStrong" style={{ flex: 1 }}>
            Private channel
          </T>
          <Switch
            value={draft.isPrivate}
            disabled={home}
            onValueChange={(isPrivate) => onChange({ ...draft, isPrivate })}
            trackColor={{ true: c.accent, false: c.border }}
            thumbColor={c.surface}
            accessibilityLabel={i18n.t('channel.privateLabel', 'Private channel')}
          />
        </View>
        <T variant="meta" color="textMuted">
          {home
            ? "#general stays open: anyone on the project can join it."
            : draft.isPrivate
              ? "Only the people ticked below can see this channel. Others cannot find or join it."
              : draft.channel
                ? "Everyone on the project is in it; people added to the project later join it too."
                : "Everyone on the project joins it, and people added later too. You can take people out afterwards."}
        </T>
      </View>

      {!draft.channel && !draft.isPrivate ? null : (
        <View>
          <T
            variant="label"
            color="textMuted"
            style={{ marginBottom: space.xs }}
          >
            People in this channel
          </T>
          {members.map(({ user }) => {
            const on = draft.memberIds.includes(user.id);
            return (
              <Pressable
                key={user.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(user.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  minHeight: 48,
                }}
              >
                <Feather
                  name={on ? "check-square" : "square"}
                  size={20}
                  color={on ? c.accent : c.textFaint}
                />
                <Avatar id={user.id} name={user.name} size={28} />
                <T variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {user.name}
                </T>
              </Pressable>
            );
          })}
          <T variant="meta" color="textFaint" style={{ marginTop: space.xs }}>
            {members.length === 0
              ? "Add people to the project first (Members), then pick their channels here."
              : "The owner and admins can see every project channel."}
          </T>
        </View>
      )}
    </View>
  );
}
