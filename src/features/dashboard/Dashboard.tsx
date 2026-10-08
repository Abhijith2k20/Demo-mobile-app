// Company dashboard (Owner/Admin). Not offline data: TanStack Query against GET /dashboard,
// cached numbers shown first, and a "Couldn't refresh" chip when the request fails.
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Card, EmptyState, Skeleton, StagePill } from '@/components/basics';
import { PhotoTile } from '@/components/PhotoGrid';
import { T } from '@/components/T';
import { api } from '@/lib/api/client';
import { stageColors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { DashboardResponse } from '@/types/models';
import { firstName, useStageLabel, useUsers } from '../shared';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('GET', '/dashboard'),
    refetchInterval: 30_000,
  });
}

function StatTile({ value, label, tone }: { value: number; label: string; tone?: 'danger' | 'warning' }) {
  const { c } = useTheme();
  const color = tone === 'danger' && value > 0 ? c.danger : tone === 'warning' && value > 0 ? c.warning : c.text;
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.card, padding: space.md }}>
      <T variant="display" style={{ color }}>
        {value}
      </T>
      <T variant="meta" color="textMuted">
        {label}
      </T>
    </View>
  );
}

export function Dashboard({ embedded }: { embedded?: boolean }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const users = useUsers();
  const stageLabel = useStageLabel();
  const q = useDashboard();
  const d = q.data;
  const total = d ? d.byStage.reduce((n, s) => n + s.count, 0) : 0;

  return (
    <View style={{ flex: 1 }}>
      {embedded ? (
        <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <T variant="title">Dashboard</T>
          <T variant="meta" color="textMuted">
            Aanya Interiors · {format(new Date(), 'EEE d MMM')}
          </T>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isLoading} onRefresh={() => void q.refetch()} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
        {q.isError && d ? (
          <Pressable
            onPress={() => void q.refetch()}
            accessibilityRole="button"
            style={{ alignSelf: 'flex-start', backgroundColor: c.warningSoft, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
            <T variant="metaStrong" color="warning">
              Couldn&apos;t refresh · showing {formatDistanceToNowStrict(parseISO(d.generatedAt))} old numbers
            </T>
          </Pressable>
        ) : null}

        {!d ? (
          q.isError ? (
            <EmptyState
              icon="cloud-off"
              title="Couldn't load the dashboard"
              hint="Check the connection and pull down to try again."
            />
          ) : (
            <Skeleton rows={6} avatar={false} />
          )
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              <StatTile value={d.stats.activeProjects} label="Active projects" />
              <StatTile value={d.stats.delayed} label="Delayed" tone="danger" />
              <StatTile value={d.stats.dueThisWeek} label="Tasks due this week" />
              <StatTile value={d.stats.blocked} label="Blocked" tone="warning" />
            </View>

            <Card>
              <T variant="label" color="textMuted" style={{ marginBottom: space.md }}>
                Projects by stage
              </T>
              <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: c.surfaceAlt, gap: 2 }}>
                {d.byStage
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <View key={s.stage} style={{ flex: s.count / Math.max(1, total), backgroundColor: stageColors(c, s.stage).fg }} />
                  ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md, rowGap: space.sm }}>
                {d.byStage.map((s) => (
                  <View key={s.stage} style={{ width: '33.3%', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: stageColors(c, s.stage).fg, opacity: s.count ? 1 : 0.35 }} />
                    <T variant="meta" color={s.count ? 'text' : 'textFaint'} numberOfLines={1}>
                      {stageLabel(s.stage)} <T variant="metaStrong" color={s.count ? 'text' : 'textFaint'}>{s.count}</T>
                    </T>
                  </View>
                ))}
              </View>
            </Card>

            <View>
              <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                Delayed projects
              </T>
              {d.delayedProjects.length === 0 ? (
                <Card>
                  <T variant="body" color="textMuted">
                    No project is behind its baseline.
                  </T>
                </Card>
              ) : (
                <Card style={{ padding: 0 }}>
                  {d.delayedProjects.map((p, i) => {
                    const pm = p.pmId ? users.byId.get(p.pmId) : undefined;
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        onPress={() => router.push(`/project/${p.id}`)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                        <View style={{ flex: 1, gap: 4 }}>
                          <T variant="bodyStrong" numberOfLines={1}>
                            {p.name}
                          </T>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                            <StagePill stage={p.stage} label={stageLabel(p.stage)} />
                            <T variant="metaStrong" color="danger">
                              {p.daysBehind} {p.daysBehind === 1 ? 'day' : 'days'} behind
                            </T>
                          </View>
                        </View>
                        {pm ? (
                          <View style={{ alignItems: 'center', gap: 2 }}>
                            <Avatar id={pm.id} name={pm.name} size={28} />
                            <T variant="meta" color="textMuted">
                              {firstName(pm.name)}
                            </T>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </Card>
              )}
            </View>

            <View>
              <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                Today on sites
              </T>
              {d.todayOnSites.length === 0 ? (
                <Card>
                  <T variant="body" color="textMuted">
                    No site updates yet today.
                  </T>
                </Card>
              ) : (
                <View style={{ gap: space.sm }}>
                  {d.todayOnSites.map((item) => {
                    const who = users.byId.get(item.userId);
                    return (
                      <Card key={item.id}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                          {who ? <Avatar id={who.id} name={who.name} size={20} /> : null}
                          <T variant="metaStrong" style={{ flex: 1 }} numberOfLines={1}>
                            {item.projectName}
                          </T>
                          <T variant="meta" color="textMuted">
                            {format(parseISO(item.at), 'h:mm a')}
                          </T>
                        </View>
                        <T variant="body" numberOfLines={3} style={{ marginTop: 4 }}>
                          {item.text}
                        </T>
                        {item.attachments.length > 0 ? (
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm }}>
                            {item.attachments.slice(0, 4).map((a) => (
                              <View key={a.id} style={{ width: 56, height: 56 }}>
                                <PhotoTile photo={a} small />
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </Card>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
