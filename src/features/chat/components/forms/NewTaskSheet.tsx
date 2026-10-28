// New task from chat: creates the task and posts its card in the channel.
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Chip } from '@/components/basics';
import { DateField, Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { newTaskFormSchema, type NewTaskForm } from '@/contract/schemas';
import { todayIso } from '@/lib/format';
import { space } from '@/theme/spacing';
import { firstName, useProjectMembers } from '../../../shared';
import { createTask } from '../../../tasks/api';
import { useTaskDefaults } from '../../../tasks/hooks';
import { type SheetProps } from './parts';

export function NewTaskSheet({ visible, onClose, projectId, channelId, initialName }: SheetProps & { initialName?: string }) {
  const { t } = useTranslation();
  const members = useProjectMembers(projectId);
  // The server picks the phase being worked on and dates after its last task.
  const defaults = useTaskDefaults(projectId, null, visible);
  const phases = defaults?.phaseChoices ?? [];
  const filled = useRef(false);
  const { control, handleSubmit, reset, getValues, setValue, formState } = useForm<NewTaskForm>({
    resolver: zodResolver(newTaskFormSchema),
    defaultValues: { name: '', phase: '', ownerId: null, plannedStart: todayIso(), plannedFinish: todayIso(), description: '' },
  });
  useEffect(() => {
    if (!visible) filled.current = false;
    // Once per opening, when the defaults arrive: later changes must not wipe what the user typed.
    else if (defaults && !filled.current) {
      filled.current = true;
      const { phase, plannedStart, plannedFinish } = defaults;
      reset({ name: initialName ?? '', phase, plannedStart, plannedFinish, ownerId: null, description: '' });
    }
  }, [visible, defaults, initialName, reset]);
  const start = useWatch({ control, name: 'plannedStart' });
  const e = formState.errors;

  const submit = handleSubmit((v) => {
    createTask({ projectId, channelId, ...v, description: v.description.trim() || null }, { cardChannelId: channelId });
    onClose();
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={t('forms.newTask', 'New task')} full>
      <Field label={t('forms.taskName', 'Name')} error={e.name?.message}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <SheetInput value={field.value} onChangeText={field.onChange} placeholder={t('forms.taskNameHint', 'e.g. Order supplies')} />
          )}
        />
      </Field>
      <Field label={t('forms.phase', 'Phase')} error={e.phase?.message}>
        <Controller
          control={control}
          name="phase"
          render={({ field }) => (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {phases.map((p) => (
                <Chip key={p} label={p} selected={field.value === p} onPress={() => field.onChange(p)} />
              ))}
            </View>
          )}
        />
      </Field>
      <Field label={t('forms.owner', 'Owner')} error={e.ownerId?.message}>
        <Controller
          control={control}
          name="ownerId"
          render={({ field }) => (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip label={t('forms.unassigned', 'Unassigned')} selected={field.value === null} onPress={() => field.onChange(null)} />
              {members.map(({ user }) => (
                <Chip key={user.id} label={firstName(user.name)} selected={field.value === user.id} onPress={() => field.onChange(user.id)} />
              ))}
            </View>
          )}
        />
      </Field>
      <Field label={t('forms.start', 'Planned start')} error={e.plannedStart?.message}>
        <Controller
          control={control}
          name="plannedStart"
          render={({ field }) => (
            <DateField
              title={t('forms.start', 'Planned start')}
              value={field.value}
              onChange={(d) => {
                field.onChange(d);
                if (getValues('plannedFinish') < d) setValue('plannedFinish', d);
              }}
            />
          )}
        />
      </Field>
      <Field label={t('forms.finish', 'Planned finish')} error={e.plannedFinish?.message}>
        <Controller control={control} name="plannedFinish" render={({ field }) => <DateField title={t('forms.finish', 'Planned finish')} value={field.value} onChange={field.onChange} min={start} />} />
      </Field>
      <Field label={t('forms.description', 'Description')} error={e.description?.message}>
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <SheetInput value={field.value} onChangeText={field.onChange} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
          )}
        />
      </Field>
      <Button label={t('forms.addTask', 'Add task')} icon="plus" onPress={() => void submit()} />
    </Sheet>
  );
}
