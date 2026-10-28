// Report an issue: posts an issue card; urgent ones mention the managers (the server picks them).
import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { Button, Chip, Segmented } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { issueFormSchema, type IssueForm } from '@/contract/schemas';
import { todayIso } from '@/lib/format';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { NO_FILTERS } from '../../../tasks/filters';
import { useProjectTasks } from '../../../tasks/hooks';
import { type SheetProps, PhotoPicker } from './parts';
import { sendMessage, useProblemTypes } from '../../../shared';

export function IssueSheet({ visible, onClose: onCloseProp, projectId, channelId }: SheetProps) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const problems = useProblemTypes();
  // Tasks being worked on, filtered by the server.
  const { tasks } = useProjectTasks(projectId, { ...NO_FILTERS, statuses: ['in_progress', 'blocked'] });
  const open = tasks.slice(0, 12);
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
              {problems.all.map((p) => (
                <Chip key={p.key} large tone="danger" label={p.label} selected={field.value === p.key} onPress={() => field.onChange(p)} />
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
