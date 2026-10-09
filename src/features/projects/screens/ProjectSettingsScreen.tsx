// Project settings (Managers, Owner, Admin): details, channels, people.
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Pill } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { createChannel, deleteChannel, updateChannel } from '@/features/projects/api';
import { useChannelMembership, useProjectChannels } from '@/features/projects/hooks';
import { shortProjectName, useProject, useProjectAccess, useUnsentCount } from '@/features/shared';
import { useProjectMembers } from '@/features/tasks/hooks';
import { channelCreateSchema, normalizeChannelName } from '@/shared/schemas';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel, ID } from '@/types/models';
import { ChannelEditor, HOME_CHANNEL, type ChannelDraft } from '../components/settings/ChannelEditor';
import { DetailsForm } from '../components/settings/DetailsForm';
import { ProjectLifecycle } from '../components/settings/ProjectLifecycle';

function SettingsScreen({ projectId: id, openChannelId }: { projectId: string; openChannelId?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const project = useProject(id);
  const access = useProjectAccess(id);
  const channels = useProjectChannels(id);
  const members = useProjectMembers(id);
  const membership = useChannelMembership(id);
  const unsent = useUnsentCount();
  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [shown, setShown] = useState<ChannelDraft | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Channel | null>(null);
  const [openedFromLink, setOpenedFromLink] = useState(false);
  if (draft && draft !== shown) setShown(draft);

  const canChannels = access.can('channel.manage');
  const canEdit = access.can('project.edit');
  const canMembers = access.can('project.members');
  const managerIds = useMemo(() => members.filter((m) => m.member.role === 'manager').map((m) => m.user.id), [members]);
  const projectUserIds = useMemo(() => new Set(members.map((m) => m.user.id)), [members]);
  const inChannel = (channelId: ID) => members.filter((m) => (membership.get(m.user.id) ?? []).includes(channelId)).map((m) => m.user.id);

  const edit = (ch: Channel) => {
    setNameError(undefined);
    setDraft({ channel: ch, name: ch.name, isPrivate: ch.isPrivate, memberIds: inChannel(ch.id) });
  };
  const add = () => {
    setNameError(undefined);
    // A new channel starts public with everyone in it; switching to private is one tap.
    setDraft({ channel: null, name: '', isPrivate: false, memberIds: [...projectUserIds] });
  };

  // Arriving from a channel's "Channel settings" opens that channel's editor once.
  if (!openedFromLink && openChannelId && canChannels && channels.length > 0 && members.length > 0) {
    setOpenedFromLink(true);
    const target = channels.find((ch) => ch.id === openChannelId);
    if (target) edit(target);
  }

  const save = () => {
    const d = draft;
    if (!d || !project) return;
    const name = d.channel?.name === HOME_CHANNEL ? HOME_CHANNEL : normalizeChannelName(d.name);
    const parsed = channelCreateSchema.shape.name.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      return;
    }
    if (channels.some((ch) => ch.name === name && ch.id !== d.channel?.id)) {
      setNameError('This project already has a channel with that name.');
      return;
    }
    const memberIds = [...new Set([...d.memberIds, ...managerIds])];
    if (d.channel) {
      const before = inChannel(d.channel.id);
      const sameMembers = before.length === memberIds.length && before.every((x) => memberIds.includes(x));
      updateChannel(d.channel, {
        ...(name !== d.channel.name ? { name } : {}),
        ...(d.isPrivate !== d.channel.isPrivate ? { isPrivate: d.isPrivate } : {}),
        ...(sameMembers ? {} : { memberIds }),
      });
    } else {
      createChannel({ projectId: project.id, name, isPrivate: d.isPrivate, memberIds });
    }
    setDraft(null);
  };

  const d = draft ?? shown;
  const anything = canEdit || canChannels || canMembers || access.canArchive || access.isAdmin;

  return (
    <Screen>
      <Header title="Project settings" subtitle={project ? shortProjectName(project.name) : undefined} />
      <OfflineBanner waiting={unsent.waiting} />
      {!project ? (
        <EmptyState icon="folder" title="This project isn't available" hint="You may no longer have access to it." />
      ) : !anything ? (
        <EmptyState icon="lock" title="Only managers can change project settings" hint="Ask a project manager, the owner or an admin." />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + space.xxl }}>
            {project.archivedAt ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.warningSoft, borderRadius: 14, padding: space.md }}>
                <Feather name="archive" size={18} color={c.warning} />
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">Archived</T>
                  <T variant="meta" color="textMuted">
                    Read-only. Nothing has been deleted.
                  </T>
                </View>
              </View>
            ) : null}

            <View>
              <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                Details
              </T>
              <DetailsForm key={project.id} project={project} canEdit={canEdit} />
            </View>

            <View>
              <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                Channels
              </T>
              <Card style={{ padding: 0 }}>
                {channels.map((ch, i) => {
                  const count = inChannel(ch.id).length;
                  return (
                    <Pressable
                      key={ch.id}
                      disabled={!canChannels}
                      accessibilityRole={canChannels ? 'button' : undefined}
                      onPress={() => edit(ch)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        padding: space.md,
                        borderTopWidth: i ? 1 : 0,
                        borderTopColor: c.border,
                        backgroundColor: pressed ? c.surfaceAlt : 'transparent',
                      })}>
                      <View style={{ width: 20, alignItems: 'center' }}>
                        <Feather name={ch.isPrivate ? 'lock' : 'hash'} size={16} color={c.textMuted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <T variant="bodyStrong" numberOfLines={1}>
                          {ch.name}
                        </T>
                        <T variant="meta" color="textMuted">
                          {ch.isPrivate ? 'Private' : 'Public'} · {count} {count === 1 ? 'person' : 'people'}
                        </T>
                      </View>
                      {canChannels ? <Feather name="chevron-right" size={18} color={c.textFaint} /> : null}
                    </Pressable>
                  );
                })}
              </Card>
              {canChannels ? <Button kind="secondary" icon="plus" label="Add channel" style={{ marginTop: space.sm }} onPress={add} /> : null}
            </View>

            <View>
              <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                People
              </T>
              <Card style={{ padding: 0 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/project/${project.id}/members`)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
                  <Feather name="users" size={18} color={c.textMuted} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">Members</T>
                    <T variant="meta" color="textMuted">
                      {members.length} {members.length === 1 ? 'person' : 'people'} · {managerIds.length} {managerIds.length === 1 ? 'manager' : 'managers'}
                    </T>
                  </View>
                  {canMembers ? (
                    <View>
                      <Pill label="Add or edit" bg={c.accentSoft} fg={c.accent} />
                    </View>
                  ) : null}
                  <Feather name="chevron-right" size={18} color={c.textFaint} />
                </Pressable>
              </Card>
              <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
                Roles, job titles and each person&apos;s channels are set on the Members screen.
              </T>
            </View>

            <ProjectLifecycle project={project} access={access} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <Sheet
        visible={!!draft}
        onClose={() => setDraft(null)}
        title={d ? (d.channel ? `# ${d.channel.name}` : 'New channel') : ''}
        subtitle={project ? shortProjectName(project.name) : undefined}
        headerRight={
          d?.channel && d.channel.name !== HOME_CHANNEL ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete #${d.channel.name}`}
              hitSlop={8}
              onPress={() => {
                const target = d.channel;
                setDraft(null);
                setDeleting(target);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: touch.min, paddingHorizontal: space.sm }}>
              <Feather name="trash-2" size={16} color={c.danger} />
              <T variant="metaStrong" color="danger">
                Delete
              </T>
            </Pressable>
          ) : undefined
        }
        full>
        {d ? (
          <View style={{ gap: space.lg }}>
            <ChannelEditor draft={d} members={members} onChange={setDraft} error={nameError} />
            <Button label={d.channel ? 'Save' : 'Create channel'} onPress={save} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Delete #${deleting.name}?` : ''}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          The channel and all its messages and photos are removed for everyone. This can&apos;t be undone.
        </T>
        <Button
          kind="danger"
          label="Delete channel"
          onPress={() => {
            if (deleting) deleteChannel(deleting);
            setDeleting(null);
          }}
        />
        <Button kind="ghost" label="Cancel" onPress={() => setDeleting(null)} />
      </Sheet>

    </Screen>
  );
}

export default appScreen(SettingsScreen);
