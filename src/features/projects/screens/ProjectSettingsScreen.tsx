// Project settings (Managers, Owner, Admin): details, channels, people.
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Card, EmptyState, Pill, type IconName } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { Field, Input } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { createChannel, deleteChannel, deleteProject, setProjectArchived, updateChannel, updateProjectDetails } from '@/features/projects/api';
import { useChannelMembership, useProjectChannels } from '@/features/projects/hooks';
import { shortProjectName, useProject, useProjectAccess, useUnsentCount } from '@/features/shared';
import { useProjectMembers, type MemberRow } from '@/features/tasks/hooks';
import { channelCreateSchema, normalizeChannelName, projectDetailsSchema } from '@/shared/schemas';
import { toast } from '@/stores/ui';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel, ID, Project } from '@/types/models';

const HOME_CHANNEL = 'general';

function ActionRow({ icon, title, subtitle, onPress, danger }: { icon: IconName; title: string; subtitle: string; onPress: () => void; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      <Feather name={icon} size={18} color={danger ? c.danger : c.textMuted} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" color={danger ? 'danger' : 'text'}>
          {title}
        </T>
        <T variant="meta" color="textMuted">
          {subtitle}
        </T>
      </View>
      <Feather name="chevron-right" size={18} color={c.textFaint} />
    </Pressable>
  );
}

function DetailsForm({ project, canEdit }: { project: Project; canEdit: boolean }) {
  // null = showing the saved values; an object = the user is editing.
  const [draft, setDraft] = useState<{ name: string; client: string; address: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const value = draft ?? { name: project.name, client: project.client, address: project.address };
  const set = (patch: Partial<typeof value>) => setDraft({ ...value, ...patch });

  const save = () => {
    const parsed = projectDetailsSchema.safeParse(value);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    updateProjectDetails(project, parsed.data);
    setDraft(null);
    setErrors({});
    toast('Project details saved.', 'success');
  };

  if (!canEdit) {
    return (
      <Card>
        <T variant="bodyStrong">{project.name}</T>
        <T variant="meta" color="textMuted">
          {project.client}
        </T>
        <T variant="meta" color="textMuted">
          {project.address}
        </T>
      </Card>
    );
  }
  return (
    <View>
      <Field label="Project name" error={errors.name}>
        <Input value={value.name} onChangeText={(name) => set({ name })} />
      </Field>
      <Field label="Client" error={errors.client}>
        <Input value={value.client} onChangeText={(client) => set({ client })} />
      </Field>
      <Field label="Site address" error={errors.address}>
        <Input value={value.address} onChangeText={(address) => set({ address })} multiline />
      </Field>
      {draft ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Save details" onPress={save} />
          </View>
          <Button
            kind="secondary"
            full={false}
            label="Cancel"
            onPress={() => {
              setDraft(null);
              setErrors({});
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

interface Draft {
  /** null when creating a new channel. */
  channel: Channel | null;
  name: string;
  isPrivate: boolean;
  memberIds: ID[];
}

function ChannelEditor({
  draft,
  members,
  onChange,
  error,
}: {
  draft: Draft;
  members: MemberRow[];
  onChange: (d: Draft) => void;
  error?: string;
}) {
  const { c } = useTheme();
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
            placeholder="e.g. electrical"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
        )}
      </Field>

      <View style={{ marginTop: -space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.worker }}>
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
          const manager = member.role === 'manager';
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

function SettingsScreen({ projectId: id, openChannelId }: { projectId: string; openChannelId?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const project = useProject(id);
  const access = useProjectAccess(id);
  const channels = useProjectChannels(id);
  const members = useProjectMembers(id);
  const membership = useChannelMembership(id);
  const unsent = useUnsentCount();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shown, setShown] = useState<Draft | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Channel | null>(null);
  const [openedFromLink, setOpenedFromLink] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [typed, setTyped] = useState('');
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
  const shortName = project ? shortProjectName(project.name) : '';

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

            {access.canArchive || access.isAdmin ? (
              <View>
                <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                  Project
                </T>
                <Card style={{ padding: 0 }}>
                  {access.canArchive ? (
                    project.archivedAt ? (
                      <ActionRow
                        icon="rotate-ccw"
                        title="Unarchive project"
                        subtitle="Make it active again"
                        onPress={() => setProjectArchived(project, false)}
                      />
                    ) : (
                      <ActionRow
                        icon="archive"
                        title="Archive project"
                        subtitle="Read-only. Can be undone."
                        onPress={() => setArchiving(true)}
                      />
                    )
                  ) : null}
                  {access.isAdmin ? (
                    <View style={{ borderTopWidth: access.canArchive ? 1 : 0, borderTopColor: c.border }}>
                      <ActionRow
                        danger
                        icon="trash-2"
                        title="Delete project"
                        subtitle="Permanent, for everyone."
                        onPress={() => {
                          setTyped('');
                          setRemoving(true);
                        }}
                      />
                    </View>
                  ) : null}
                </Card>
                {access.isAdmin ? null : (
                  <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
                    Only the owner or an admin can delete a project.
                  </T>
                )}
              </View>
            ) : null}
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

      <Sheet visible={archiving} onClose={() => setArchiving(false)} title={`Archive ${shortName}?`}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          People can still read it, but nobody can post or change anything until it is unarchived. Nothing is deleted.
        </T>
        <Button
          icon="archive"
          label="Archive project"
          onPress={() => {
            if (project) setProjectArchived(project, true);
            setArchiving(false);
          }}
        />
        <Button kind="ghost" label="Cancel" onPress={() => setArchiving(false)} />
      </Sheet>

      <Sheet visible={removing} onClose={() => setRemoving(false)} title={`Delete ${shortName}?`}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.md }}>
          All its channels, messages, photos and tasks are removed for everyone. This can&apos;t be undone.
        </T>
        <Field label={`Type ${shortName} to confirm`}>
          <SheetInput value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} placeholder={shortName} />
        </Field>
        <Button
          kind="danger"
          icon="trash-2"
          label="Delete project"
          disabled={typed.trim().toLowerCase() !== shortName.toLowerCase()}
          onPress={() => {
            setRemoving(false);
            if (project) deleteProject(project);
            router.dismissTo('/');
          }}
        />
        <Button kind="ghost" label="Cancel" onPress={() => setRemoving(false)} />
      </Sheet>
    </Screen>
  );
}

export default appScreen(SettingsScreen);
