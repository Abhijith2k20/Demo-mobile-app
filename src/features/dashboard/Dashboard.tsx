// Company dashboard (Owner/Admin). Not offline data: TanStack Query against GET /dashboard,
// cached numbers shown first, and a "Couldn't refresh" chip when the request fails.
//
// Layout, top to bottom: one headline (is anything wrong?), four numbers, every project with its
// health, what is blocked, where projects sit in the pipeline, and the latest from site.
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Card, EmptyState, Skeleton, StagePill, type IconName } from '@/components/basics';
import { PhotoTile } from '@/components/PhotoGrid';
import { T } from '@/components/T';
import { api } from '@/lib/api/client';
import type { ColorToken } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { useLargeText, useTheme } from '@/theme/useTheme';
import type { DashboardResponse } from '@/types/models';
import { firstName, shortProjectName, useStageLabel, useUsers } from '../shared';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('GET', '/dashboard'),
    refetchInterval: 30_000,
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: space.sm }}>
        <T variant="label" color="textMuted" style={{ flex: 1 }}>
          {title}
        </T>
        {right ? (
          <T variant="meta" color="textFaint">
            {right}
          </T>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One number with its label. The number stays in text ink; a small icon carries the state. */
function Stat({ value, label, flag }: { value: number; label: string; flag?: { icon: IconName; color: ColorToken } }) {
  const { c } = useTheme();
  const lines = useLargeText() ? 3 : 1;
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.card, paddingHorizontal: space.md, paddingVertical: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <T variant="meta" color="textMuted" style={{ flex: 1 }} numberOfLines={lines}>
          {label}
        </T>
        {flag ? <Feather name={flag.icon} size={14} color={c[flag.color]} /> : null}
      </View>
      <T variant="display" style={{ marginTop: 2 }}>
        {value}
      </T>
    </View>
  );
}

/** Schedule health in words plus an icon, never colour alone. */
function Health({ delayDays }: { delayDays: number | null }) {
  const { c } = useTheme();
  const state =
    delayDays === null
      ? { icon: 'minus' as const, color: 'textFaint' as const, text: 'No baseline' }
      : delayDays > 0
        ? { icon: 'alert-triangle' as const, color: 'danger' as const, text: `${delayDays}d behind` }
        : delayDays < 0
          ? { icon: 'check-circle' as const, color: 'success' as const, text: `${-delayDays}d ahead` }
          : { icon: 'check-circle' as const, color: 'success' as const, text: 'On track' };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Feather name={state.icon} size={13} color={c[state.color]} />
      <T variant="metaStrong" color={state.color === 'textFaint' ? 'textMuted' : state.color}>
        {state.text}
      </T>
    </View>
  );
}

export function Dashboard({ embedded }: { embedded?: boolean }) {
  const { c } = useTheme();
  // At large text sizes, wrap instead of truncating (HIG: Supporting Dynamic Type).
  const large = useLargeText();
  const lines = large ? 3 : 1;
  const insets = useSafeAreaInsets();
  const users = useUsers();
  const stageLabel = useStageLabel();
  const q = useDashboard();
  const d = q.data;

  const issues: string[] = [];
  if (d && d.stats.delayed > 0) issues.push(plural(d.stats.delayed, 'project is behind schedule', 'projects are behind schedule'));
  if (d && d.stats.blocked > 0) issues.push(plural(d.stats.blocked, 'task is blocked', 'tasks are blocked'));

  return (
    <View style={{ flex: 1 }}>
      {embedded ? (
        <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <T variant="title">Dashboard</T>
          <T variant="meta" color="textMuted">
            {format(new Date(), 'EEEE, d MMMM')}
            {d ? ` · updated ${format(parseISO(d.generatedAt), 'h:mm a')}` : ''}
          </T>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isLoading} onRefresh={() => void q.refetch()} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
        {!d ? (
          q.isError ? (
            <EmptyState icon="cloud-off" title="Couldn't load the dashboard" hint="Check the connection and pull down to try again." />
          ) : (
            <Skeleton rows={6} avatar={false} />
          )
        ) : (
          <>
            <View style={{ gap: space.md }}>
              {q.isError ? (
                <Pressable
                  onPress={() => void q.refetch()}
                  accessibilityRole="button"
                  style={{ alignSelf: 'flex-start', backgroundColor: c.warningSoft, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
                  <T variant="metaStrong" color="warning">
                    Couldn&apos;t refresh · showing {formatDistanceToNowStrict(parseISO(d.generatedAt))} old numbers
                  </T>
                </Pressable>
              ) : null}

              {/* Headline: the one thing to know before reading anything else. */}
              <View
                accessibilityRole="summary"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  backgroundColor: issues.length ? c.warningSoft : c.successSoft,
                  borderRadius: radius.card,
                  padding: space.md,
                }}>
                <Feather name={issues.length ? 'alert-triangle' : 'check-circle'} size={20} color={issues.length ? c.warning : c.success} />
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{issues.length ? 'Needs attention' : 'Everything is on track'}</T>
                  <T variant="meta" color="textMuted">
                    {issues.length ? `${issues.join(' and ')}.` : 'No project is behind its baseline and nothing is blocked.'}
                  </T>
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                <Stat value={d.stats.activeProjects} label="Active projects" />
                <Stat value={d.stats.delayed} label="Behind schedule" flag={d.stats.delayed > 0 ? { icon: 'alert-triangle', color: 'danger' } : undefined} />
                <Stat value={d.stats.dueThisWeek} label="Tasks due in 7 days" />
                <Stat value={d.stats.blocked} label="Blocked tasks" flag={d.stats.blocked > 0 ? { icon: 'alert-circle', color: 'warning' } : undefined} />
              </View>
            </View>

            <Section title="Projects" right="Most delayed first">
              {d.projects.length === 0 ? (
                <Card>
                  <T variant="body" color="textMuted">
                    No active projects.
                  </T>
                </Card>
              ) : (
                <Card style={{ padding: 0 }}>
                  {d.projects.map((p, i) => {
                    const pm = p.pmId ? users.byId.get(p.pmId) : undefined;
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        onPress={() => router.push(`/project/${p.id}`)}
                        style={({ pressed }) => ({ padding: space.md, gap: space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
                        <View style={{ flexDirection: 'row', flexWrap: large ? 'wrap' : 'nowrap', alignItems: 'center', gap: space.sm }}>
                          <T variant="bodyStrong" numberOfLines={lines} style={large ? { width: '100%' } : { flexShrink: 1 }}>
                            {shortProjectName(p.name)}
                          </T>
                          <StagePill stage={p.stage} label={stageLabel(p.stage)} />
                          {large ? null : <View style={{ flex: 1 }} />}
                          <Health delayDays={p.delayDays} />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
                            <View style={{ width: `${p.percent}%`, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
                          </View>
                          <T variant="metaStrong" style={{ minWidth: 36, textAlign: 'right' }}>
                            {p.percent}%
                          </T>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                          <T variant="meta" color="textMuted" style={{ flex: 1 }} numberOfLines={lines}>
                            {p.doneTasks} of {plural(p.totalTasks, 'task', 'tasks')} done
                            {p.blocked > 0 ? ` · ${p.blocked} blocked` : ''}
                          </T>
                          {pm ? (
                            <>
                              <Avatar id={pm.id} name={pm.name} size={20} />
                              <T variant="meta" color="textMuted">
                                {firstName(pm.name)}
                              </T>
                            </>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </Card>
              )}
            </Section>

            {d.blockedTasks.length > 0 ? (
              <Section title="Blocked now">
                <Card style={{ padding: 0 }}>
                  {d.blockedTasks.map((task, i) => {
                    const owner = task.ownerId ? users.byId.get(task.ownerId) : undefined;
                    return (
                      <Pressable
                        key={task.id}
                        accessibilityRole="button"
                        onPress={() => router.push(`/task/${task.id}`)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.md,
                          minHeight: 56,
                          borderTopWidth: i ? 1 : 0,
                          borderTopColor: c.border,
                          backgroundColor: pressed ? c.surfaceAlt : 'transparent',
                        })}>
                        <Feather name="alert-circle" size={16} color={c.danger} />
                        <View style={{ flex: 1 }}>
                          <T variant="body" numberOfLines={lines}>
                            {task.name}
                          </T>
                          <T variant="meta" color="textMuted" numberOfLines={lines}>
                            {task.projectName}
                            {owner ? ` · ${firstName(owner.name)}` : ' · Unassigned'}
                          </T>
                        </View>
                        <Feather name="chevron-right" size={18} color={c.textFaint} />
                      </Pressable>
                    );
                  })}
                </Card>
              </Section>
            ) : null}

            <Section title="Pipeline" right="Projects in each stage">
              {/* Two rows of three so stage names fit at a readable size. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1, borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.border }}>
                {d.byStage.map((s) => (
                  <View key={s.stage} accessible accessibilityLabel={`${stageLabel(s.stage)}: ${s.count}`} style={{ flexGrow: 1, flexBasis: '32%', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.xs, backgroundColor: c.surface }}>
                    <T variant="heading" color={s.count ? 'text' : 'textFaint'}>
                      {s.count}
                    </T>
                    <T variant="meta" color={s.count ? 'textMuted' : 'textFaint'} style={{ textAlign: 'center' }}>
                      {stageLabel(s.stage)}
                    </T>
                  </View>
                ))}
              </View>
            </Section>

            <Section title="From site" right="Last 36 hours">
              {d.todayOnSites.length === 0 ? (
                <Card>
                  <T variant="body" color="textMuted">
                    No site updates yet.
                  </T>
                </Card>
              ) : (
                <Card style={{ padding: 0 }}>
                  {d.todayOnSites.map((item, i) => {
                    const who = users.byId.get(item.userId);
                    return (
                      <View key={item.id} style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                        {who ? <Avatar id={who.id} name={who.name} size={28} /> : <View style={{ width: 28 }} />}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                            <T variant="metaStrong" style={{ flex: 1 }} numberOfLines={lines}>
                              {item.projectName}
                            </T>
                            <T variant="meta" color="textFaint">
                              {format(parseISO(item.at), 'h:mm a')}
                            </T>
                          </View>
                          <T variant="meta" color="textMuted" numberOfLines={2} style={{ fontSize: 14, lineHeight: 19 }}>
                            {item.text}
                          </T>
                          {item.attachments.length > 0 ? (
                            <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm }}>
                              {item.attachments.slice(0, 4).map((a) => (
                                <View key={a.id} style={{ width: 48, height: 48 }}>
                                  <PhotoTile photo={a} small />
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </Card>
              )}
            </Section>
          </>
        )}
      </ScrollView>
    </View>
  );
}
