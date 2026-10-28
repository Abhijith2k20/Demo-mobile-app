// Project members: list for everyone, add / edit / remove for Managers (§5.11).
import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Avatar, Button, Chip, EmptyState, Pill, Row, Segmented } from '@/components/basics';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel, ID, JobTitle, Meta, ProjectRole, User } from '@/types/models';
import { addMember, removeMember, updateMember } from '../api';
import { useChannelMembership, useProjectChannels } from '../hooks';
import { firstName, isBotUser, useMeta, useProjectAccess, useProjectMembers, useRoleLabels, useUsers, type MemberRow } from '../../shared';

interface Draft {
  user: User;
  role: ProjectRole;
  jobTitle: JobTitle;
  channelIds: ID[];
  isNew: boolean;
}

/** Pre-ticks the channels the server would pick for this role and job title (it decides on save). */
function defaultsFor(channels: Channel[], role: ProjectRole, jobTitle: JobTitle, meta: Meta | undefined): ID[] {
  // `?.`: a /meta saved on the phone from an older server may not have it yet.
  if (meta?.rolesInEveryChannel?.includes(role)) return channels.map((c) => c.id);
  const names = meta?.defaultChannels[role]?.[jobTitle] ?? [];
  return channels.filter((c) => names.includes(c.name)).map((c) => c.id);
}

function MemberEditor({ draft, channels, onChange }: { draft: Draft; channels: Channel[]; onChange: (d: Draft) => void }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const meta = useMeta();
  // Changing role or job title re-ticks the default channels (§9.3); they stay editable.
  const set = (patch: Partial<Pick<Draft, 'role' | 'jobTitle'>>) => {
    const next = { ...draft, ...patch };
    onChange({ ...next, channelIds: defaultsFor(channels, next.role, next.jobTitle, meta) });
  };
  // The company's job titles; some are for managers only.
  const titles = (meta?.jobTitles ?? []).filter((jt) => draft.role === 'manager' || !jt.managersOnly);
  const managersOnly = (name: JobTitle) => !!meta?.jobTitles.find((jt) => jt.name === name)?.managersOnly;
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: 6 }}>
        <T variant="label" color="textMuted">
          {t('members.role', 'Role')}
        </T>
        <Segmented
          value={draft.role}
          onChange={(role) =>
            set({ role, jobTitle: role === 'member' && managersOnly(draft.jobTitle) ? (meta?.defaultJobTitle ?? draft.jobTitle) : draft.jobTitle })
          }
          options={[
            { value: 'member', label: t('you.member', 'Member') },
            { value: 'manager', label: t('you.manager', 'Manager') },
          ]}
        />
        <T variant="meta" color="textMuted">
          {draft.role === 'manager'
            ? t('members.managerHint', 'Managers can edit dates, confirm tasks, lock the baseline and manage members.')
            : t('members.memberHint', 'Members can chat, add tasks and update their own tasks.')}
        </T>
      </View>
      <View style={{ gap: 6 }}>
        <T variant="label" color="textMuted">
          {t('members.jobTitle', 'Job title')}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {titles.map((jt) => (
            <Chip key={jt.name} label={jt.label} selected={draft.jobTitle === jt.name} onPress={() => set({ jobTitle: jt.name })} />
          ))}
        </View>
      </View>
      <View style={{ gap: 2 }}>
        <T variant="label" color="textMuted">
          {t('members.channels', 'Channels')}
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
  const { t } = useTranslation();
  const labels = useRoleLabels();
  const meta = useMeta();
  const access = useProjectAccess(projectId);
  const canManage = access.can('project.members');
  const rows = useProjectMembers(projectId);
  const channels = useProjectChannels(projectId);
  const membership = useChannelMembership(projectId);
  const users = useUsers();
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
    return users.list.filter(
      (u) => !existing.has(u.id) && u.isActive && !isBotUser(u) && u.joinsProjects && u.name.toLowerCase().includes(q),
    );
  }, [users.list, rows, query]);

  const startEdit = (row: MemberRow) =>
    setDraft({ user: row.user, role: row.member.role, jobTitle: row.member.jobTitle, channelIds: membership.get(row.user.id) ?? [], isNew: false });
  const startAdd = (user: User) => {
    setPicker(false);
    setQuery('');
    const jobTitle = meta?.defaultJobTitle ?? '';
    setDraft({ user, role: 'member', jobTitle, channelIds: defaultsFor(channels, 'member', jobTitle, meta), isNew: true });
  };
  const d = draft ?? shownDraft;

  return (
    <View>
      {canManage ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Button icon="user-plus" label={t('members.add', 'Add member')} kind="secondary" onPress={() => setPicker(true)} />
        </View>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="users" title={t('members.empty', 'No members yet')} hint={canManage ? t('members.emptyHint', 'Add the people who work on this project.') : undefined} />
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
                    label={labels.project(row.member.role)}
                    bg={row.member.role === 'manager' ? c.accentSoft : c.surfaceAlt}
                    fg={row.member.role === 'manager' ? c.accent : c.textMuted}
                  />
                </View>
              </View>
              <T variant="meta" color="textMuted" numberOfLines={1}>
                {labels.jobTitle(row.member.jobTitle)}
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

      <Sheet visible={picker} onClose={() => setPicker(false)} title={t('members.add', 'Add member')} subtitle={t('members.addHint', 'Search the company directory')} full>
        <SheetInput value={query} onChangeText={setQuery} placeholder={t('home.searchPeople', 'Search people')} />
        <View style={{ marginHorizontal: -space.lg, marginTop: space.sm }}>
          {candidates.length === 0 ? (
            <EmptyState icon="users" title={t('members.noneToAdd', 'No one to add')} hint={t('members.noneToAddHint', 'Everyone in the directory is already on this project.')} />
          ) : (
            candidates.map((u) => <Row key={u.id} left={<Avatar id={u.id} name={u.name} size={32} />} title={u.name} height={52} onPress={() => startAdd(u)} />)
          )}
        </View>
      </Sheet>

      <Sheet visible={!!draft} onClose={() => setDraft(null)} title={d ? (d.isNew ? t('members.addName', 'Add {{name}}', { name: d.user.name }) : d.user.name) : ''} full>
        {d ? (
          <View style={{ gap: space.lg }}>
            <MemberEditor draft={d} channels={channels} onChange={setDraft} />
            <Button
              label={d.isNew ? t('members.addShort', 'Add') : t('common.save', 'Save')}
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
                label={t('members.remove', 'Remove from project')}
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

      <Sheet visible={!!removing} onClose={() => setRemoving(null)} title={t('members.removeTitle', 'Remove member?')}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {t('members.removeBody', '{{name}} will lose access to this project. Their messages stay.', { name: firstName(removing?.user.name) })}
        </T>
        <Button
          kind="danger"
          label={t('members.removeShort', 'Remove')}
          onPress={() => {
            if (removing) removeMember(projectId, removing.user.id);
            setRemoving(null);
          }}
        />
        <Button kind="ghost" label={t('common.cancel', 'Cancel')} onPress={() => setRemoving(null)} />
      </Sheet>
    </View>
  );
}
