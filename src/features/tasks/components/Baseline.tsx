// Baseline lock and re-baseline (Managers).
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Button } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { rebaselineSchema } from '@/shared/schemas';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Project } from '@/types/models';
import type { ProjectAccess } from '../../shared';
import { lockBaseline } from '../api';

/** Lock baseline (Managers) when it isn't locked; a lock icon + Re-baseline once it is. */
export function BaselineControl({ project, access, onRebaseline }: { project: Project; access: ProjectAccess; onRebaseline: () => void }) {
  const { c } = useTheme();
  const [confirm, setConfirm] = useState(false);
  const canBaseline = access.can('task.baseline');
  if (!project.baselineLocked) {
    if (!canBaseline) return null;
    return (
      <>
        <Button small full={false} kind="secondary" icon="lock" label="Lock baseline" onPress={() => setConfirm(true)} />
        <Sheet visible={confirm} onClose={() => setConfirm(false)} title="Lock baseline?">
          <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
            Today&apos;s planned dates become the baseline. Later date changes will show as variance against it.
          </T>
          <Button
            label="Lock baseline"
            icon="lock"
            onPress={() => {
              lockBaseline(project, null);
              setConfirm(false);
            }}
          />
        </Sheet>
      </>
    );
  }
  return (
    <Pressable
      disabled={!canBaseline}
      onPress={onRebaseline}
      accessibilityLabel={canBaseline ? 'Baseline locked. Re-baseline' : 'Baseline locked'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.sm }}>
      <Feather name="lock" size={14} color={c.textMuted} />
      {canBaseline ? (
        <T variant="metaStrong" color="accent">
          Re-baseline
        </T>
      ) : (
        <T variant="meta" color="textMuted">
          Baseline locked
        </T>
      )}
    </Pressable>
  );
}

export function RebaselineSheet({ project, visible, onClose }: { project: Project; visible: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <Sheet visible={visible} onClose={onClose} title="Re-baseline the schedule">
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
          setReason('');
          setError(undefined);
          onClose();
        }}
      />
    </Sheet>
  );
}
