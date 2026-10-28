// Daily report: what was done, how many people worked, problems, tomorrow's plan.
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/basics';
import { Field, Stepper } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { dailyReportFormSchema, type DailyReportForm } from '@/contract/schemas';
import { todayIso } from '@/lib/format';
import { type SheetProps, PhotoPicker } from './parts';
import { sendMessage } from '../../../shared';

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
        {area('workDone', t('forms.workDoneHint', 'What got done today?'))}
      </Field>
      <Field label={t('forms.workers', 'People working today')} error={e.workers?.message}>
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
