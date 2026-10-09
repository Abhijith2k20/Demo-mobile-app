// Project members: list for everyone, add / edit / remove for Managers (§5.11).
import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Button, Chip, EmptyState, Pill, Row, Segmented } from '@/components/basics';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { defaultChannelNames } from '@/shared/permissions';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel, ID, JobTitle, ProjectRole, User } from '@/types/models';
import { useDirectory } from '../home/hooks';
import { addMember, removeMember, updateMember } from '../projects/api';
import { useChannelMembership, useProjectChannels } from '../projects/hooks';
import { firstName, useProjectAccess, useUsers } from '../shared';
import { useProjectMembers, type MemberRow } from '../tasks/hooks';

const TITLES: JobTitle[] = ['Designer', 'QS', 'Supervisor', 'Worker'];

interface Draft {
  user: User;
  role: ProjectRole;
  jobTitle: JobTitle;
  channelIds: ID[];
  isNew: boolean;
}

function defaultsFor(channels: Channel[], role: ProjectRole, jobTitle: JobTitle): ID[] {
  if (role === 'manager') return channels.map((c) => c.id); // managers are in every channel
  const names = defaultChannelNames(role, jobTitle);
  return channels.filter((c) => names.includes(c.name)).map((c) => c.id);
}

function MemberEditor({ draft, channels, onChange }: { draft: Draft; channels: Channel[]; onChange: (d: Draft) => void }) {
  const { c } = useTheme();
  // Changing role or job title re-ticks the default channels (§9.3); they stay editable.
  const set = (patch: Partial<Pick<Draft, 'role' | 'jobTitle'>>) => {
    const next = { ...draft, ...patch };
    onChange({ ...next, channelIds: defaultsFor(channels, next.role, next.jobTitle) });
  };
  const titles: JobTitle[] = draft.role === 'manager' ? ['Project Manager', ...TITLES] : TITLES;
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: 6 }}>
        <T variant="label" color="textMuted">
          Role
        </T>
        <Segmented
          value={draft.role}
          onChange={(role) => set({ role, jobTitle: role === 'member' && draft.jobTitle === 'Project Manager' ? 'Supervisor' : draft.jobTitle })}
          options={[
            { value: 'member', label: 'Member' },
            { value: 'manager', label: 'Manager' },
          ]}
        />
        <T variant="meta" color="textMuted">
          {draft.role === 'manager'
            ? 'Managers can edit dates, confirm tasks, lock the baseline and manage members.'
            : 'Members can chat, add tasks and update their own tasks.'}
        </T>
      </View>
      <View style={{ gap: 6 }}>
        <T variant="label" color="textMuted">
          Job title
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {titles.map((jt) => (
            <Chip key={jt} label={jt} selected={draft.jobTitle === jt} onPress={() => set({ jobTitle: jt })} />
          ))}
        </View>
      </View>
      <View style={{ gap: 2 }}>
        <T variant="label" color="textMuted">
          Channels
        </T>
        {channels.map((ch) => {
          const on = draft.channelIds.includes(ch.id);
          return (
            <Pressable
              key={ch.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => onChange({ ...draft, channelIds: on ? draft.channelIds.filter((x) => x !== ch.id) : [...draft.channelIds, ch.id] })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
              <Feather name={on ? 'check-square' : 'square'} size={20} color={on ? c.accent : c.textFaint} />
              <T variant="body" style={{ flex: 1 }}>
                {ch.isPrivate ? '🔒 ' : '# '}
                {ch.name}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function MembersManager({ projectId }: { projectId: ID }) {
  const { c } = useTheme();
  const access = useProjectAccess(projectId);
  const canManage = access.can('project.members');
  const rows = useProjectMembers(projectId);
  const channels = useProjectChannels(projectId);
  const membership = useChannelMembership(projectId);
  const local = useUsers();
  const directory = useDirectory();
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  // Keep showing the last draft while its sheet animates out.
  const [shownDraft, setShownDraft] = useState<Draft | null>(null);
  if (draft && draft !== shownDraft) setShownDraft(draft);

  const channelName = useMemo(() => new Map(channels.map((ch) => [ch.id, ch.name])), [channels]);
  const candidates = useMemo(() => {
    const existing = new Set(rows.map((r) => r.user.id));
    const q = query.trim().toLowerCase();
    return (directory.data ?? local.list).filter(
      (u) => !existing.has(u.id) && u.phone !== '0000000000' && u.companyRole === 'member' && u.name.toLowerCase().includes(q),
    );
  }, [directory.data, local.list, rows, query]);

  const startEdit = (row: MemberRow) =>
    setDraft({ user: row.user, role: row.member.role, jobTitle: row.member.jobTitle, channelIds: membership.get(row.user.id) ?? [], isNew: false });
  const startAdd = (user: User) => {
    setPicker(false);
    setQuery('');
    setDraft({ user, role: 'member', jobTitle: 'Worker', channelIds: defaultsFor(channels, 'member', 'Worker'), isNew: true });
  };
  const d = draft ?? shownDraft;

  return (
    <View>
      {canManage ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Button icon="user-plus" label="Add member" kind="secondary" onPress={() => setPicker(true)} />
        </View>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="users" title="No members yet" hint={canManage ? 'Add the people who work on this project.' : undefined} />
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.user.id}
            disabled={!canManage}
            onPress={() => startEdit(row)}
            accessibilityRole={canManage ? 'button' : undefined}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              backgroundColor: pressed ? c.surfaceAlt : 'transparent',
            })}>
            <Avatar id={row.user.id} name={row.user.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <T variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {row.user.name}
                </T>
                <View>
                  <Pill
                    label={row.member.role === 'manager' ? 'Manager' : 'Member'}
                    bg={row.member.role === 'manager' ? c.accentSoft : c.surfaceAlt}
                    fg={row.member.role === 'manager' ? c.accent : c.textMuted}
                  />
                </View>
              </View>
              <T variant="meta" color="textMuted" numberOfLines={1}>
                {row.member.jobTitle}
                {(membership.get(row.user.id) ?? []).length
                  ? ` · ${(membership.get(row.user.id) ?? [])
                      .map((id) => `#${channelName.get(id) ?? ''}`)
                      .join(' ')}`
                  : ''}
              </T>
            </View>
            {canManage ? <Feather name="chevron-right" size={18} color={c.textFaint} /> : null}
          </Pressable>
        ))
      )}

      <Sheet visible={picker} onClose={() => setPicker(false)} title="Add member" subtitle="Search the company directory" full>
        <SheetInput value={query} onChangeText={setQuery} placeholder="Search people" />
        <View style={{ marginHorizontal: -space.lg, marginTop: space.sm }}>
          {candidates.length === 0 ? (
            <EmptyState icon="users" title="No one to add" hint="Everyone in the directory is already on this project." />
          ) : (
            candidates.map((u) => <Row key={u.id} left={<Avatar id={u.id} name={u.name} size={32} />} title={u.name} height={52} onPress={() => startAdd(u)} />)
          )}
        </View>
      </Sheet>

      <Sheet visible={!!draft} onClose={() => setDraft(null)} title={d ? (d.isNew ? `Add ${d.user.name}` : d.user.name) : ''} full>
        {d ? (
          <View style={{ gap: space.lg }}>
            <MemberEditor draft={d} channels={channels} onChange={setDraft} />
            <Button
              label={d.isNew ? 'Add' : 'Save'}
              onPress={() => {
                const input = { projectId, userId: d.user.id, role: d.role, jobTitle: d.jobTitle, channelIds: d.channelIds };
                if (d.isNew) addMember(input);
                else updateMember(input);
                setDraft(null);
              }}
            />
            {d.isNew ? null : (
              <Button
                kind="danger"
                icon="user-minus"
                label="Remove from project"
                onPress={() => {
                  const row = rows.find((r) => r.user.id === d.user.id) ?? null;
                  setDraft(null);
                  setRemoving(row);
                }}
              />
            )}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!removing} onClose={() => setRemoving(null)} title="Remove member?">
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {firstName(removing?.user.name)} will lose access to this project. Their messages stay.
        </T>
        <Button
          kind="danger"
          label="Remove"
          onPress={() => {
            if (removing) removeMember(projectId, removing.user.id);
            setRemoving(null);
          }}
        />
        <Button kind="ghost" label="Cancel" onPress={() => setRemoving(null)} />
      </Sheet>
    </View>
  );
}
