// The schedule's three-dot menu: baseline lock and re-baseline (Managers).
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, type IconName } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { rebaselineSchema } from '@/contract/schemas';
import { shortProjectName } from '../../shared';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Project } from '@/types/models';
import { lockBaseline } from '../api';

function MenuRow({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 40, height: 40, borderRadius: radius.input, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={18} color={c.text} />
      </View>
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong">{title}</T>
        <T variant="meta" color="textMuted">
          {subtitle}
        </T>
      </View>
      <Feather name="chevron-right" size={18} color={c.textFaint} />
    </Pressable>
  );
}

type Step = 'menu' | 'lock' | 'rebaseline';

/** Opened from the three dots above the task list. Only shown to people who may change the baseline. */
export function ScheduleMenu({ project, visible, onClose }: { project: Project; visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const close = () => {
    onClose();
    setStep('menu');
    setReason('');
    setError(undefined);
  };
  const locked = project.baselineLocked;

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={step === 'menu' ? 'Schedule' : step === 'lock' ? 'Lock baseline?' : 'Re-baseline the schedule'}
      subtitle={step === 'menu' ? shortProjectName(project.name) : undefined}>
      {step === 'menu' ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.surfaceAlt, borderRadius: radius.input, padding: space.md, marginBottom: space.sm }}>
            <Feather name={locked ? 'lock' : 'unlock'} size={15} color={c.textMuted} />
            <T variant="meta" color="textMuted" style={{ flex: 1 }}>
              {locked
                ? `Baseline locked${project.baselineFinish ? ` · finish ${format(parseISO(project.baselineFinish), 'd MMM yyyy')}` : ''}`
                : 'No baseline yet. Date changes are not tracked as variance.'}
            </T>
          </View>
          {locked ? (
            <MenuRow icon="refresh-cw" title="Re-baseline" subtitle="Replace the baseline with today's plan" onPress={() => setStep('rebaseline')} />
          ) : (
            <MenuRow icon="lock" title="Lock baseline" subtitle="Freeze today's plan to measure delays against" onPress={() => setStep('lock')} />
          )}
        </View>
      ) : step === 'lock' ? (
        <View>
          <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
            Today&apos;s planned dates become the baseline. Later date changes will show as variance against it.
          </T>
          <Button
            label="Lock baseline"
            icon="lock"
            onPress={() => {
              lockBaseline(project, null);
              close();
            }}
          />
          <Button kind="ghost" label="Cancel" onPress={close} />
        </View>
      ) : (
        <View>
          <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
            The current planned dates replace the old baseline and variance goes back to zero. The reason is logged in #general.
          </T>
          <Field label="Reason" error={error}>
            <SheetInput value={reason} onChangeText={setReason} placeholder="e.g. Client added the study room" />
          </Field>
          <Button
            label="Re-baseline"
            icon="refresh-cw"
            onPress={() => {
              const parsed = rebaselineSchema.safeParse({ reason });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message);
                return;
              }
              lockBaseline(project, parsed.data.reason);
              close();
            }}
          />
          <Button kind="ghost" label="Cancel" onPress={close} />
        </View>
      )}
    </Sheet>
  );
}
