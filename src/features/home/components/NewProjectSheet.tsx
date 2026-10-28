// Owner/Admin: create a project (the server adds its four channels).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { createProject } from '@/features/projects/api';
import { fieldErrors } from '@/lib/mutations';
import { projectCreateSchema } from '@/contract/schemas';

export function NewProjectSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const parsed = projectCreateSchema.omit({ id: true }).safeParse({ name, client, address });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setSaving(true);
    const res = await createProject(parsed.data);
    setSaving(false);
    if ('error' in res) {
      setErrors(fieldErrors(res.error));
      return;
    }
    setName('');
    setClient('');
    setAddress('');
    setErrors({});
    onClose();
    // Open it only once the server has it.
    router.push(`/project/${res.data.id}`);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('home.newProject', 'New project')} full>
      <Field label={t('project.name', 'Project name')} error={errors.name}>
        <SheetInput value={name} onChangeText={setName} placeholder="Rao Apartment – HSR Layout" />
      </Field>
      <Field label={t('project.client', 'Client')} error={errors.client}>
        <SheetInput value={client} onChangeText={setClient} />
      </Field>
      <Field label={t('project.address', 'Site address')} error={errors.address}>
        <SheetInput value={address} onChangeText={setAddress} />
      </Field>
      <Button label={t('project.create', 'Create project')} loading={saving} onPress={() => void submit()} />
    </Sheet>
  );
}

