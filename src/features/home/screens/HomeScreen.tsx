import { Feather } from '@expo/vector-icons';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge, EmptyState, Row, SectionHeader, Skeleton, StagePill } from '@/components/basics';
import { appScreen, OfflineBanner, Screen } from '@/components/chrome';
import { CompanyTile } from '@/components/CompanyTile';
import { T } from '@/components/T';
import { useHome } from '@/features/home/hooks';
import { isBotUser, shortProjectName, useCan, useCompany, useMe, useRefresh, useStages, useUsers } from '@/features/shared';
import { useUi } from '@/stores/ui';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel } from '@/types/models';
import { NewProjectSheet } from '@/features/home/components/NewProjectSheet';

function ChannelGlyph({ channel, strong }: { channel: Channel; strong: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 20, alignItems: 'center' }}>
      {channel.isPrivate ? (
        <Feather name="lock" size={15} color={strong ? c.text : c.textMuted} />
      ) : (
        <T variant={strong ? 'bodyStrong' : 'body'} color={strong ? 'text' : 'textMuted'}>
          #
        </T>
      )}
    </View>
  );
}

function ChannelRow({ channel, unread, indent = 0, subtitle }: { channel: Channel; unread: number; indent?: number; subtitle?: string }) {
  return (
    <Row
      indent={indent}
      left={<ChannelGlyph channel={channel} strong={unread > 0} />}
      title={channel.name}
      subtitle={subtitle}
      strong={unread > 0}
      muted
      right={<Badge count={unread} />}
      onPress={() => router.push(`/channel/${channel.id}`)}
    />
  );
}

function HomeScreen() {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const me = useMe();
  const admin = useCan()('project.create');
  const home = useHome();
  const users = useUsers();
  const company = useCompany();
  const stages = useStages();
  const stageLabel = stages.label;
  const { refreshing, refresh } = useRefresh();
  const collapsed = useUi((s) => s.collapsed);
  const toggle = useUi((s) => s.toggleCollapsed);
  const [query, setQuery] = useState('');
  const [newProject, setNewProject] = useState(false);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return null;
    return {
      projects: home.projects.filter((p) => p.project.name.toLowerCase().includes(q)),
      channels: [...home.projects.flatMap((p) => p.channels.map((ch) => ({ ch, where: shortProjectName(p.project.name) }))), ...home.company.map((ch) => ({ ch, where: t('home.company', 'Company') }))].filter(
        (x) => x.ch.name.toLowerCase().includes(q),
      ),
      people: users.list.filter((u) => u.id !== me.id && u.isActive && !isBotUser(u) && u.name.toLowerCase().includes(q)),
    };
  }, [q, home.projects, home.company, users.list, me.id, t]);

  const active = home.projects.filter((p) => !p.project.archivedAt);
  const archived = home.projects.filter((p) => p.project.archivedAt);
  // Collapsed unless the user opens it.
  const showArchived = !(collapsed.archived ?? true);

  const projectRow = ({ project, channels, unread }: (typeof home.projects)[number]) => {
                const key = `project:${project.id}`;
                const open = !(collapsed[key] ?? false);
                const delay = project.delayDays;
                return (
                  <View key={project.id}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      onPress={() => toggle(key)}
                      style={({ pressed }) => ({
                        minHeight: touch.min,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        paddingHorizontal: space.lg,
                        backgroundColor: pressed ? c.surfaceAlt : 'transparent',
                      })}>
                      <Feather name={open ? 'chevron-down' : 'chevron-right'} size={16} color={c.textMuted} />
                      <T variant={unread > 0 ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flexShrink: 1 }}>
                        {shortProjectName(project.name)}
                      </T>
                      <StagePill index={stages.index(project.stage)} label={stageLabel(project.stage)} />
                      {delay > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLabel={t('home.daysBehind', '{{count}} days behind', { count: delay })}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.danger }} />
                          <T variant="metaStrong" color="danger">
                            {delay}d
                          </T>
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }} />
                      {open ? null : <Badge count={unread} />}
                    </Pressable>
                    {open ? (
                      <>
                        {channels.map((ch) => (
                          <ChannelRow key={ch.id} channel={ch} unread={home.unread.get(ch.id) ?? 0} indent={space.xl} />
                        ))}
                        <Row
                          indent={space.xl}
                          left={
                            <View style={{ width: 20, alignItems: 'center' }}>
                              <Feather name="layout" size={15} color={c.textMuted} />
                            </View>
                          }
                          title={t('home.projectOverview', 'Project overview')}
                          muted
                          onPress={() => router.push(`/project/${project.id}`)}
                        />
                      </>
                    ) : null}
                  </View>
                );
              };

  return (
    <Screen>
      {focused ? <StatusBar style="light" /> : null}
      {/* Workspace header: ink block with the company's name. */}
      <View style={{ backgroundColor: c.header, paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <CompanyTile name={company?.name ?? ''} size={36} />
          <T variant="title" style={{ color: c.onHeader, flexShrink: 1 }} numberOfLines={1}>
            {company?.name ?? ''}
          </T>
          <Feather name="chevron-down" size={18} color={c.onHeader} style={{ opacity: 0.7 }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.headerField, borderRadius: radius.input, paddingHorizontal: space.md, minHeight: 40, gap: space.sm }}>
          <Feather name="search" size={16} color={c.onHeader} style={{ opacity: 0.6 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('home.jumpTo', 'Jump to…')}
            placeholderTextColor={c.textFaint}
            accessibilityLabel={t('home.jumpTo', 'Jump to…')}
            style={[type.body, { flex: 1, color: c.onHeader, paddingVertical: 8 }]}
          />
          {query ? (
            <Pressable hitSlop={10} onPress={() => setQuery('')} accessibilityLabel={t('common.clear', 'Clear')}>
              <Feather name="x" size={16} color={c.onHeader} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <OfflineBanner />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
        {home.loading ? (
          <Skeleton rows={8} avatar={false} />
        ) : results ? (
          <View style={{ paddingTop: space.sm }}>
            {results.projects.length + results.channels.length + results.people.length === 0 ? (
              <EmptyState icon="search" title={t('home.noResults', 'Nothing matches')} hint={t('home.noResultsHint', 'Try a channel, person or project name.')} />
            ) : null}
            {results.projects.map(({ project }) => (
              <Row
                key={project.id}
                left={<Feather name="folder" size={18} color={c.textMuted} />}
                title={project.name}
                subtitle={stageLabel(project.stage)}
                height={52}
                onPress={() => router.push(`/project/${project.id}`)}
              />
            ))}
            {results.channels.map(({ ch, where }) => (
              <ChannelRow key={ch.id} channel={ch} unread={home.unread.get(ch.id) ?? 0} subtitle={where} />
            ))}
            {results.people.map((u) => (
              <Row key={u.id} left={<Avatar id={u.id} name={u.name} size={28} />} title={u.name} onPress={() => router.push(`/dm/${u.id}`)} />
            ))}
          </View>
        ) : (
          <>
            <SectionHeader title={t('home.projects', 'Projects')} collapsed={collapsed.projects} onToggle={() => toggle('projects')} />
            {collapsed.projects ? null : home.projects.length === 0 ? (
              <T variant="meta" color="textMuted" style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                {t('home.noProjects', "You're not on any project yet. A manager can add you.")}
              </T>
            ) : (
              <>
                {active.map(projectRow)}
                {archived.length > 0 ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showArchived }}
                      onPress={() => toggle('archived', true)}
                      style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg }}>
                      <Feather name={showArchived ? 'chevron-down' : 'chevron-right'} size={16} color={c.textFaint} />
                      <Feather name="archive" size={14} color={c.textFaint} />
                      <T variant="meta" color="textMuted">
                        {t('home.archived', 'Archived ({{count}})', { count: archived.length })}
                      </T>
                    </Pressable>
                    {showArchived ? archived.map(projectRow) : null}
                  </>
                ) : null}
              </>
            )}

            <SectionHeader title={t('home.company', 'Company')} collapsed={collapsed.company} onToggle={() => toggle('company')} />
            {collapsed.company ? null : home.company.map((ch) => <ChannelRow key={ch.id} channel={ch} unread={home.unread.get(ch.id) ?? 0} />)}
          </>
        )}
      </ScrollView>

      {admin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.newProject', 'New project')}
          onPress={() => setNewProject(true)}
          style={({ pressed }) => ({
            position: 'absolute',
            right: space.lg,
            bottom: space.lg,
            width: 56,
            height: 56,
            borderRadius: radius.card + 4,
            backgroundColor: c.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
            shadowColor: c.shadow,
            shadowOpacity: 0.25,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 5,
          })}>
          <Feather name="folder-plus" size={22} color={c.onAccent} />
        </Pressable>
      ) : null}
      <NewProjectSheet visible={newProject} onClose={() => setNewProject(false)} />
    </Screen>
  );
}

export default appScreen(HomeScreen);
