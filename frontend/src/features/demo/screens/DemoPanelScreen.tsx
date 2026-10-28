// Demo panel (§13): plays "the outside world" (network, teammates, the bot, server admin)
// through the mock backend's /internal endpoints.
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Chip, Pill, Segmented } from '@/components/basics';
import { ErrorBoundary, Header, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { useDemoAccounts } from '@/features/auth/hooks';
import { demo, type Injection, type NetworkMode } from '@/features/demo/api';
import { shortProjectName, useAllProjectMembers, useProjects } from '@/features/shared';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { API_URL, isSimulatedOffline, setSimulatedOffline } from '@/lib/api/transport';
import { refreshAll } from '@/lib/queries';
import { signInWithEmail, wipeEverything } from '@/lib/session';
import { useDemo } from '@/stores/demo';
import { useSession } from '@/stores/session';
import { toast, useUi } from '@/stores/ui';
import { space } from '@/theme/spacing';
import { fonts } from '@/theme/typography';
import { useTheme } from '@/theme/useTheme';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View>
        <T variant="label" color="textMuted">
          {title}
        </T>
        {hint ? (
          <T variant="meta" color="textFaint">
            {hint}
          </T>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Mono({ children, color }: { children: ReactNode; color?: 'text' | 'textMuted' | 'danger' | 'success' | 'warning' }) {
  return (
    <T variant="meta" color={color ?? 'text'} style={{ fontFamily: fonts.medium, fontSize: 11.5, lineHeight: 16 }}>
      {children}
    </T>
  );
}

const INJECTIONS: { value: Injection; label: string }[] = [
  { value: '500', label: '500 server error' },
  { value: '403', label: '403 forbidden' },
  { value: '422', label: '422 validation' },
  { value: 'timeout_after_save', label: 'Timeout after save' },
];

function DemoPanel() {
  const { c } = useTheme();
  const demoUsers = useDemoAccounts();
  const insets = useSafeAreaInsets();
  const user = useSession((s) => s.user);
  const socketConnected = useUi((s) => s.socketConnected);
  const online = useUi((s) => s.online);
  const apiLog = useDemo((s) => s.apiLog);
  const eventLog = useDemo((s) => s.eventLog);
  const clearLogs = useDemo((s) => s.clearLogs);
  const projects = useProjects();
  const memberships = useAllProjectMembers();
  const [switching, setSwitching] = useState<string | null>(null);
  const [phoneOffline, setPhoneOffline] = useState(isSimulatedOffline);
  const server = useQuery({ queryKey: ['demo-state'], queryFn: demo.state, refetchInterval: 5000 });
  const net = server.data?.network ?? { mode: 'online' as NetworkMode, inject: null };

  const mine = memberships.filter((m) => m.userId === user?.id);

  /** Runs a server control; shows a message when the server can't be reached. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      await server.refetch();
      if (done) toast(done);
    } catch (e) {
      toast(isAppError(e) ? errorText(e) : 'The server did not answer.', 'danger');
    }
  };

  const switchTo = async (email: string) => {
    setSwitching(email);
    try {
      await signInWithEmail(email);
      router.dismissTo('/');
    } catch (e) {
      toast(isAppError(e) ? errorText(e) : 'Could not switch user.', 'danger');
    } finally {
      setSwitching(null);
    }
  };

  const needUser = (fn: (id: string) => Promise<unknown>, done?: string) => () => {
    if (!user) toast('Sign in first.');
    else void run(() => fn(user.id), done);
  };

  const reset = () =>
    run(async () => {
      await demo.reset();
      await wipeEverything();
      clearLogs();
      router.replace('/login');
      toast('Demo reset. All data is back to the seed.', 'success');
    });

  return (
    <Screen>
      <Header title="Demo panel" subtitle="Change the world around the app" close />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + space.xxl }}>
        <Section title="1 · Who am I" hint="Switching signs in again; nothing from the previous person is kept.">
          <Card style={{ padding: 0 }}>
            {demoUsers.map((u, i) => {
              const current = user?.email === u.email;
              return (
                <View
                  key={u.email}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, backgroundColor: current ? c.accentSoft : 'transparent' }}>
                  <Avatar id={current && user ? user.id : u.email} name={u.name} size={32} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" numberOfLines={1}>
                      {u.name}
                    </T>
                    <T variant="meta" color="textMuted">
                      {u.subtitle}
                    </T>
                  </View>
                  {current ? (
                    <View>
                      <Pill label="You" bg={c.accent} fg={c.onAccent} />
                    </View>
                  ) : (
                    <Button small full={false} kind="secondary" label="Switch" loading={switching === u.email} disabled={!!switching} onPress={() => void switchTo(u.email)} />
                  )}
                </View>
              );
            })}
          </Card>
          {user ? (
            <Card>
              <T variant="metaStrong">
                {user.name} · company role: {user.companyRole}
              </T>
              {user.companyRole !== 'member' ? (
                <T variant="meta" color="textMuted">
                  Sees every project and channel, but never other people&apos;s DMs.
                </T>
              ) : mine.length === 0 ? (
                <T variant="meta" color="textMuted">
                  Not on any project.
                </T>
              ) : (
                mine.map((m) => (
                  <T key={m.projectId} variant="meta" color="textMuted">
                    {shortProjectName(projects.byId.get(m.projectId)?.name ?? 'Project')} — {m.role} · {m.jobTitle}
                  </T>
                ))
              )}
            </Card>
          ) : null}
        </Section>

        <Section title="2 · Network" hint={`Server: ${API_URL}`}>
          <Segmented<NetworkMode>
            value={net.mode}
            onChange={(mode) => void run(() => demo.setNetwork({ mode }))}
            options={[
              { value: 'online', label: 'Online' },
              { value: 'slow', label: 'Slow' },
              { value: 'flaky', label: 'Flaky' },
            ]}
          />
          <T variant="meta" color="textMuted">
            {net.mode === 'online' && 'The server answers as fast as it can.'}
            {net.mode === 'slow' && 'The server waits 2–4 s before answering; uploads longer.'}
            {net.mode === 'flaky' && '30% of changes time out after 8 s — some after the server already saved them.'}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <T variant="bodyStrong" style={{ flex: 1 }}>
              Phone offline
            </T>
            <Switch
              value={phoneOffline}
              onValueChange={(v) => {
                setSimulatedOffline(v);
                setPhoneOffline(v);
                if (!v) void refreshAll();
              }}
              trackColor={{ true: c.danger, false: c.border }}
              thumbColor={c.surface}
              accessibilityLabel="Phone offline"
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: socketConnected ? c.success : c.danger }} />
            <T variant="metaStrong">
              Live updates: {socketConnected ? 'connected' : 'disconnected'} · API: {online ? 'reachable' : 'unreachable'}
            </T>
          </View>
        </Section>

        <Section title="3 · Inject" hint="Applies to the next change the app sends (not to sign-in or read markers).">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {INJECTIONS.map((inj) => (
              <Chip
                key={inj.value}
                label={inj.label}
                tone="danger"
                selected={net.inject === inj.value}
                onPress={() => void run(() => demo.setNetwork({ inject: net.inject === inj.value ? 'none' : inj.value }))}
              />
            ))}
          </View>
          {net.inject ? (
            <T variant="meta" color="danger">
              Armed: the next change will get “{INJECTIONS.find((i) => i.value === net.inject)?.label}”.
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" label="Force token expiry" onPress={needUser(demo.expireToken, 'Access token expired. The next request refreshes it silently.')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                small
                kind="danger"
                label="Deactivate me"
                onPress={needUser(async (id) => {
                  await demo.deactivate(id);
                  // Any request now gets 401 and the refresh fails, which signs the app out.
                  void refreshAll();
                })}
              />
            </View>
          </View>
        </Section>

        <Section title="4 · Bot" hint="Sent to the current user's Siteline Bot DM.">
          <Button small kind="secondary" icon="sun" label="Send morning summary now" onPress={needUser(demo.morningSummary)} />
          <Button small kind="secondary" icon="moon" label="Send evening check-in now" onPress={needUser(demo.eveningCheckin)} />
          <Button
            small
            kind="secondary"
            icon="bell"
            label="Trigger escalation now"
            onPress={needUser(async (id) => {
              const r = await demo.escalate(id);
              toast(r.escalated ? 'Escalated to the project managers.' : 'No unanswered check-in to escalate. Send a check-in first.');
            })}
          />
        </Section>

        <Section title="5 · Teammates" hint="Scripted teammates act every 20–40 s while someone is signed in.">
          <Button
            small
            kind="secondary"
            icon={server.data?.actorsPaused ? 'play' : 'pause'}
            label={server.data?.actorsPaused ? 'Resume scripted activity' : 'Pause scripted activity'}
            onPress={() => void run(() => demo.setActorsPaused(!server.data?.actorsPaused))}
          />
          <Button small kind="secondary" icon="calendar" label="Amit shifts 5 tasks now" onPress={() => void run(demo.amitShifts, 'Amit moved 5 tasks by a day. One batched Activity item follows in ~10 s.')} />
          <Button small kind="secondary" icon="lock" label="Someone posts in a private channel now" onPress={() => void run(demo.rohanPosts, 'Posted in Villa 99 #qs (visible to QS, Managers, Owner and Admin only).')} />
        </Section>

        <Section title="6 · Refresh" hint="The app keeps nothing on the phone; this fetches everything on screen again.">
          <Button small kind="secondary" icon="refresh-cw" label="Refresh now" onPress={() => void refreshAll()} />
        </Section>

        <Section title="7 · Log" hint="Newest first. This is the only place codes and request ids are shown.">
          <Card>
            <T variant="label" color="textMuted" style={{ marginBottom: 4 }}>
              API calls
            </T>
            {apiLog.length === 0 ? <Mono color="textMuted">No calls yet.</Mono> : null}
            {apiLog.map((e) => {
              const bad = typeof e.status !== 'number' || e.status >= 400;
              return (
                <Mono key={e.id} color={bad ? 'danger' : 'text'}>
                  {e.method} {e.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f-]{22}/g, (m) => `…${m.slice(-5)}`).slice(0, 46)} → {e.status}
                  {e.code ? ` ${e.code}` : ''} · {e.ms}ms · {e.requestId.slice(-6)}
                </Mono>
              );
            })}
          </Card>
          <Card>
            <T variant="label" color="textMuted" style={{ marginBottom: 4 }}>
              Events received
            </T>
            {eventLog.length === 0 ? <Mono color="textMuted">No events yet.</Mono> : null}
            {eventLog.map((e) => (
              <Mono key={e.id}>
                {format(e.at, 'HH:mm:ss')} {e.type} · {e.summary}
              </Mono>
            ))}
          </Card>
        </Section>

        <Section title="8 · Reset" hint="Server data goes back to the seed and you sign in again.">
          <Button kind="danger" icon="rotate-ccw" label="Reset demo" onPress={() => void reset()} />
        </Section>
      </ScrollView>
    </Screen>
  );
}

export default function DemoRoute() {
  return (
    <ErrorBoundary>
      <DemoPanel />
    </ErrorBoundary>
  );
}
