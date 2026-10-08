// In-chat forms (§6): New task, Report issue, Daily report. Schemas mirror the backend.
import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Chip, Segmented } from '@/components/basics';
import { DateField, Field, Stepper } from '@/components/form';
import { PhotoTile } from '@/components/PhotoGrid';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import {
  dailyReportFormSchema,
  ISSUE_PRESETS,
  issueFormSchema,
  newTaskFormSchema,
  type DailyReportForm,
  type IssueForm,
  type NewTaskForm,
} from '@/shared/schemas';
import { isDone, todayIso } from '@/shared/taskRules';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { PHASES, type ID } from '@/types/models';
import { firstName } from '../../shared';
import { createTask, quickAddDefaults } from '../../tasks/api';
import { useProjectMembers, useProjectTasks } from '../../tasks/hooks';
import { sendMessage } from '../api';
import { pickPhotos } from '../photos';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  projectId: ID;
  channelId: ID;
}

function PhotoPicker({ uris, onChange, max }: { uris: string[]; onChange: (next: string[]) => void; max: number }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const add = async (source: 'camera' | 'gallery') => {
    const picked = await pickPhotos(source, max - uris.length);
    if (picked.length) onChange([...uris, ...picked].slice(0, max));
  };
  return (
    <View style={{ gap: space.sm }}>
      {uris.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {uris.map((uri, i) => (
            <View key={uri} style={{ width: 72, height: 72 }}>
              <PhotoTile photo={{ id: uri, kind: 'image', uri, uploadId: null }} small />
              <Pressable
                accessibilityLabel={t('photos.remove', 'Remove photo')}
                hitSlop={8}
                onPress={() => onChange(uris.filter((_, j) => j !== i))}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: c.text,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Feather name="x" size={13} color={c.surface} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {uris.length < max ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip icon="camera" label={t('plus.camera', 'Camera')} onPress={() => void add('camera')} />
          <Chip icon="image" label={t('plus.gallery', 'Gallery')} onPress={() => void add('gallery')} />
        </View>
      ) : null}
    </View>
  );
}

export function NewTaskSheet({ visible, onClose, projectId, channelId, initialName }: SheetProps & { initialName?: string }) {
  const { t } = useTranslation();
  const { tasks } = useProjectTasks(projectId);
  const members = useProjectMembers(projectId);
  const phases = useMemo(() => [...new Set([...tasks.map((x) => x.phase), ...PHASES])], [tasks]);
  const { control, handleSubmit, reset, getValues, setValue, formState } = useForm<NewTaskForm>({
    resolver: zodResolver(newTaskFormSchema),
    defaultValues: { name: '', phase: '', ownerId: null, plannedStart: todayIso(), plannedFinish: todayIso(), description: '' },
  });
  useEffect(() => {
    if (visible) {
      const phase = tasks.find((x) => x.status === 'in_progress')?.phase ?? phases[0] ?? 'Civil';
      reset({ name: initialName ?? '', phase, ownerId: null, description: '', ...quickAddDefaults(tasks, phase) });
    }
    // Only when the sheet opens: later task changes must not wipe what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
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
            <SheetInput value={field.value} onChangeText={field.onChange} placeholder={t('forms.taskNameHint', 'e.g. Wardrobe – guest room')} />
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
        <Controller control={control} name="plannedFinish" render={({ field }) => <DateField value={field.value} onChange={field.onChange} min={start} />} />
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

export function IssueSheet({ visible, onClose: onCloseProp, projectId, channelId }: SheetProps) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { tasks } = useProjectTasks(projectId);
  const open = useMemo(() => tasks.filter((x) => !isDone(x.status) && x.status !== 'not_started').slice(0, 12), [tasks]);
  const [photos, setPhotos] = useState<string[]>([]);
  const onClose = () => {
    setPhotos([]);
    onCloseProp();
  };
  const { control, handleSubmit, reset, formState } = useForm<IssueForm>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: { what: '', note: '', taskId: null, urgency: 'normal' },
  });
  useEffect(() => {
    if (visible) reset({ what: '', note: '', taskId: null, urgency: 'normal' });
  }, [visible, reset]);
  const e = formState.errors;

  const submit = handleSubmit((v) => {
    const task = tasks.find((x) => x.id === v.taskId);
    sendMessage({
      channelId,
      type: 'issue_card',
      body: null,
      data: {
        what: v.what,
        note: v.note.trim() || null,
        urgency: v.urgency,
        taskId: task?.id ?? null,
        taskName: task?.name ?? null,
        date: todayIso(),
      },
      photoUris: photos,
    });
    onClose();
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={t('forms.reportIssue', 'Report issue')} full>
      <Field label={t('forms.whatsWrong', "What's wrong")} error={e.what?.message}>
        <Controller
          control={control}
          name="what"
          render={({ field }) => (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {ISSUE_PRESETS.map((p) => (
                <Chip key={p} large tone="danger" label={t(`issue.preset.${p}`, p)} selected={field.value === p} onPress={() => field.onChange(p)} />
              ))}
            </View>
          )}
        />
      </Field>
      <Field label={t('forms.details', 'Details')} error={e.note?.message}>
        <Controller
          control={control}
          name="note"
          render={({ field }) => (
            <SheetInput
              value={field.value}
              onChangeText={field.onChange}
              placeholder={t('forms.detailsHint', 'Add a few words (optional)')}
              multiline
              style={{ minHeight: 64, textAlignVertical: 'top' }}
            />
          )}
        />
      </Field>
      <Field label={t('forms.photos', 'Photos')}>
        <PhotoPicker uris={photos} onChange={setPhotos} max={4} />
      </Field>
      {open.length > 0 ? (
        <Field label={t('forms.relatedTask', 'Related task (optional)')}>
          <Controller
            control={control}
            name="taskId"
            render={({ field }) => (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                {open.map((task) => (
                  <Chip
                    key={task.id}
                    label={task.name}
                    selected={field.value === task.id}
                    onPress={() => field.onChange(field.value === task.id ? null : task.id)}
                  />
                ))}
              </ScrollView>
            )}
          />
        </Field>
      ) : null}
      <Field label={t('forms.urgency', 'Urgency')}>
        <Controller
          control={control}
          name="urgency"
          render={({ field }) => (
            <Segmented
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'normal', label: t('forms.normal', 'Normal') },
                { value: 'urgent', label: t('issue.urgent', 'Urgent') },
              ]}
            />
          )}
        />
      </Field>
      <View style={{ backgroundColor: c.surfaceAlt, borderRadius: radius.input, padding: space.md, marginBottom: space.lg }}>
        <Controller
          control={control}
          name="urgency"
          render={({ field }) => (
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Feather name={field.value === 'urgent' ? 'bell' : 'info'} size={15} color={field.value === 'urgent' ? c.danger : c.textMuted} />
              <T variant="meta" color="textMuted" style={{ flex: 1 }}>
                {field.value === 'urgent'
                  ? t('forms.urgentHint', 'Urgent issues notify the project managers.')
                  : t('forms.normalHint', 'Posted to the channel for the team.')}
              </T>
            </View>
          )}
        />
      </View>
      <Button label={t('forms.sendIssue', 'Report issue')} icon="alert-triangle" onPress={() => void submit()} />
    </Sheet>
  );
}

export function DailyReportSheet({ visible, onClose: onCloseProp, channelId }: SheetProps) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<string[]>([]);
  const onClose = () => {
    setPhotos([]);
    onCloseProp();
  };
  const { control, handleSubmit, reset, formState } = useForm<DailyReportForm>({
    resolver: zodResolver(dailyReportFormSchema),
    defaultValues: { workDone: '', workers: 4, problems: '', tomorrow: '' },
  });
  useEffect(() => {
    if (visible) reset({ workDone: '', workers: 4, problems: '', tomorrow: '' });
  }, [visible, reset]);
  const e = formState.errors;

  const submit = handleSubmit((v) => {
    sendMessage({
      channelId,
      type: 'daily_report',
      body: null,
      data: { workDone: v.workDone.trim(), workers: v.workers, problems: v.problems.trim(), tomorrow: v.tomorrow.trim(), date: todayIso() },
      photoUris: photos,
    });
    onClose();
  });

  const area = (name: 'workDone' | 'problems' | 'tomorrow', placeholder: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SheetInput
          value={field.value}
          onChangeText={field.onChange}
          placeholder={placeholder}
          multiline
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
      )}
    />
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={t('forms.dailyReport', 'Daily report')} full>
      <Field label={t('forms.workDone', 'Work done today')} error={e.workDone?.message}>
        {area('workDone', t('forms.workDoneHint', 'What got done on site?'))}
      </Field>
      <Field label={t('forms.workers', 'Workers on site')} error={e.workers?.message}>
        <Controller control={control} name="workers" render={({ field }) => <Stepper value={field.value} onChange={field.onChange} />} />
      </Field>
      <Field label={t('forms.photos', 'Photos')}>
        <PhotoPicker uris={photos} onChange={setPhotos} max={6} />
      </Field>
      <Field label={t('forms.problems', 'Problems (optional)')} error={e.problems?.message}>
        {area('problems', '')}
      </Field>
      <Field label={t('forms.tomorrow', "Tomorrow's plan")} error={e.tomorrow?.message}>
        {area('tomorrow', '')}
      </Field>
      <Button label={t('forms.sendReport', 'Send report')} icon="send" onPress={() => void submit()} />
    </Sheet>
  );
}
