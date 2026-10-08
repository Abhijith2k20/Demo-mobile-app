// Demo panel (§13). One of the two places allowed to talk to the mock server directly:
// it plays the role of "the outside world" (network, teammates, the bot, server admin).
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Chip, Pill, Segmented } from '@/components/basics';
import { ErrorBoundary, Header, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { DEMO_USERS } from '@/features/auth/demoUsers';
import { shortProjectName, useAllProjectMembers, useOutbox, useProjects } from '@/features/shared';
import { clearFailed } from '@/features/unsent/api';
import { isAppError } from '@/lib/api/client';
import { errorText } from '@/lib/i18n';
import { runOutboxNow } from '@/lib/outbox/runner';
import { useNow } from '@/lib/useNow';
import { endSession, signInWithPhone } from '@/lib/session';
import { catchUp, wipeSyncedAndResync } from '@/lib/sync/catchup';
import { actorsPaused, amitShiftsTasks, onActorsChange, resetActors, rohanPostsQs, setActorsPaused } from '@/mock/actors';
import { sendEveningCheckin, sendMorningSummary, triggerEscalation } from '@/mock/bot';
import { getNetwork, onNetworkChange, setInjection, setMode, type Injection, type NetworkMode } from '@/mock/network';
import { deactivateUser, expireAccessTokens } from '@/mock/routes/auth';
import { resetServer } from '@/mock/server';
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

function useNetwork() {
  const [state, setState] = useState(getNetwork);
  useEffect(() => onNetworkChange(setState), []);
  return state;
}

const INJECTIONS: { value: Injection; label: string }[] = [
  { value: '500', label: '500 server error' },
  { value: '403', label: '403 forbidden' },
  { value: '422', label: '422 validation' },
  { value: 'timeout_after_save', label: 'Timeout after save' },
];

function DemoPanel() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useSession((s) => s.user);
  const net = useNetwork();
  const socketConnected = useUi((s) => s.socketConnected);
  const lastSyncAt = useUi((s) => s.lastSyncAt);
  const syncing = useUi((s) => s.syncing);
  const apiLog = useDemo((s) => s.apiLog);
  const eventLog = useDemo((s) => s.eventLog);
  const clearLogs = useDemo((s) => s.clearLogs);
  const outbox = useOutbox();
  const projects = useProjects();
  const memberships = useAllProjectMembers();
  const now = useNow(1000);
  const [paused, setPaused] = useState(actorsPaused);
  const [switching, setSwitching] = useState<string | null>(null);
  useEffect(() => onActorsChange(setPaused), []);

  const mine = memberships.filter((m) => m.userId === user?.id);

  const switchTo = async (phone: string) => {
    if (net.mode === 'offline') {
      toast('Go online to switch user (signing in needs the server).', 'danger');
      return;
    }
    setSwitching(phone);
    try {
      await signInWithPhone(phone);
      router.dismissTo('/');
    } catch (e) {
      toast(isAppError(e) ? errorText(e) : 'Could not switch user.', 'danger');
    } finally {
      setSwitching(null);
    }
  };

  const needUser = (fn: (id: string) => void) => () => {
    if (!user) toast('Sign in first.');
    else fn(user.id);
  };

  const reset = () => {
    endSession();
    resetActors();
    resetServer();
    clearLogs();
    router.replace('/login');
    toast('Demo reset. All data is back to the seed.', 'success');
  };

  return (
    <Screen>
      <Header title="Demo panel" subtitle="Change the world around the app" close />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + space.xxl }}>
        <Section title="1 · Who am I" hint="Switching signs in again and re-syncs from scratch.">
          <Card style={{ padding: 0 }}>
            {DEMO_USERS.map((u, i) => {
              const current = user?.phone === u.phone;
              return (
                <View
                  key={u.phone}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, backgroundColor: current ? c.accentSoft : 'transparent' }}>
                  <Avatar id={current && user ? user.id : u.phone} name={u.name} size={32} />
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
                    <Button small full={false} kind="secondary" label="Switch" loading={switching === u.phone} disabled={!!switching} onPress={() => void switchTo(u.phone)} />
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

        <Section title="2 · Network">
          <Segmented<NetworkMode>
            value={net.mode}
            onChange={setMode}
            options={[
              { value: 'online', label: 'Online' },
              { value: 'slow', label: 'Slow' },
              { value: 'flaky', label: 'Flaky' },
              { value: 'offline', label: 'Offline' },
            ]}
          />
          <T variant="meta" color="textMuted">
            {net.mode === 'online' && 'Requests take 250–900 ms.'}
            {net.mode === 'slow' && 'Requests take 2–4 s; uploads longer.'}
            {net.mode === 'flaky' && '30% of requests time out after 8 s — some after the server already saved them.'}
            {net.mode === 'offline' && 'Every request fails at once. Changes wait in the outbox.'}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: socketConnected ? c.success : c.danger }} />
            <T variant="metaStrong">Event bus: {socketConnected ? 'connected' : 'disconnected'}</T>
          </View>
        </Section>

        <Section title="3 · Inject" hint="Applies to the next change the app sends (not to sync or read markers).">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {INJECTIONS.map((inj) => (
              <Chip key={inj.value} label={inj.label} tone="danger" selected={net.inject === inj.value} onPress={() => setInjection(net.inject === inj.value ? null : inj.value)} />
            ))}
          </View>
          {net.inject ? (
            <T variant="meta" color="danger">
              Armed: the next change will get “{INJECTIONS.find((i) => i.value === net.inject)?.label}”.
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                small
                kind="secondary"
                label="Force token expiry"
                onPress={needUser((id) => {
                  expireAccessTokens(id);
                  toast('Access token expired. The next request refreshes it silently.');
                })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                small
                kind="danger"
                label="Deactivate me"
                onPress={needUser((id) => {
                  deactivateUser(id);
                  // Any request now gets 401 and the refresh fails; trigger one right away.
                  void catchUp();
                })}
              />
            </View>
          </View>
        </Section>

        <Section title="4 · Bot" hint="Sent to the current user's Siteline Bot DM.">
          <Button small kind="secondary" icon="sun" label="Send morning summary now" onPress={needUser(sendMorningSummary)} />
          <Button small kind="secondary" icon="moon" label="Send evening check-in now" onPress={needUser(sendEveningCheckin)} />
          <Button
            small
            kind="secondary"
            icon="bell"
            label="Trigger escalation now"
            onPress={needUser((id) => {
              if (!triggerEscalation(id)) toast('No unanswered check-in to escalate. Send a check-in first.');
              else toast('Escalated to the project managers.');
            })}
          />
        </Section>

        <Section title="5 · Teammates" hint="Scripted teammates act every 20–40 s while online.">
          <Button small kind="secondary" icon={paused ? 'play' : 'pause'} label={paused ? 'Resume scripted activity' : 'Pause scripted activity'} onPress={() => setActorsPaused(!paused)} />
          <Button
            small
            kind="secondary"
            icon="calendar"
            label="Amit shifts 5 tasks now"
            onPress={() => {
              amitShiftsTasks();
              toast('Amit moved 5 tasks by a day. One batched Activity item follows in ~10 s.');
            }}
          />
          <Button
            small
            kind="secondary"
            icon="lock"
            label="Rohan posts in #qs now"
            onPress={() => {
              rohanPostsQs();
              toast('Posted in Sharma #qs (visible to QS, Managers, Owner and Admin only).');
            }}
          />
        </Section>

        <Section title={`6 · Outbox inspector (${outbox.length})`}>
          <Card style={{ padding: 0 }}>
            {outbox.length === 0 ? (
              <View style={{ padding: space.md }}>
                <T variant="meta" color="textMuted">
                  Empty. Every change has reached the server.
                </T>
              </View>
            ) : (
              outbox.map((item, i) => {
                const wait = item.nextAttemptAt - now;
                return (
                  <View key={item.id} style={{ padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <T variant="metaStrong" style={{ flex: 1 }} numberOfLines={1}>
                        {item.kind}
                      </T>
                      <Pill
                        label={item.status}
                        bg={item.status === 'failed' ? c.dangerSoft : item.status === 'sending' ? c.infoSoft : c.warningSoft}
                        fg={item.status === 'failed' ? c.danger : item.status === 'sending' ? c.info : c.warning}
                      />
                    </View>
                    <Mono color="textMuted">
                      lane {item.lane.length > 22 ? `${item.lane.slice(0, 12)}…${item.lane.slice(-6)}` : item.lane} · attempts {item.attempts}
                      {item.status === 'pending' && wait > 0 ? ` · next in ${Math.ceil(wait / 1000)}s` : ''}
                      {item.dependsOn ? ' · waits on upload' : ''}
                    </Mono>
                    {item.lastErrorCode ? <Mono color="danger">last error {item.lastErrorCode}</Mono> : null}
                    {item.kind === 'update_task' ? <Mono color="textMuted">{item.payload.match(/"input":(\{[^}]*\})/)?.[1] ?? ''}</Mono> : null}
                  </View>
                );
              })
            )}
          </Card>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" icon="play" label="Run now" onPress={runOutboxNow} />
            </View>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" icon="trash-2" label="Clear failed" onPress={clearFailed} />
            </View>
          </View>
        </Section>

        <Section title="7 · Sync">
          <T variant="meta" color="textMuted">
            Last sync: {lastSyncAt ? `${format(parseISO(lastSyncAt), 'h:mm:ss a')} (${formatDistanceToNowStrict(parseISO(lastSyncAt))} ago)` : 'never'}
            {syncing ? ' · syncing…' : ''}
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" icon="refresh-cw" label="Sync now" onPress={() => void catchUp()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" icon="database" label="Wipe & re-sync" onPress={() => void wipeSyncedAndResync()} />
            </View>
          </View>
        </Section>

        <Section title="8 · Log" hint="Newest first. This is the only place codes and request ids are shown.">
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

        <Section title="9 · Reset" hint="Server data goes back to the seed, the phone's database is wiped, and you sign in again.">
          <Button kind="danger" icon="rotate-ccw" label="Reset demo" onPress={reset} />
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
