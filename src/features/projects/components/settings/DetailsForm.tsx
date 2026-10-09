// Project name, client and site address: editable for managers, plain text for everyone else.
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card } from '@/components/basics';
import { Field, Input } from '@/components/form';
import { T } from '@/components/T';
import { projectDetailsSchema } from '@/shared/schemas';
import { toast } from '@/stores/ui';
import { space } from '@/theme/spacing';
import type { Project } from '@/types/models';
import { updateProjectDetails } from '../../api';

export function DetailsForm({ project, canEdit }: { project: Project; canEdit: boolean }) {
  // null = showing the saved values; an object = the user is editing.
  const [draft, setDraft] = useState<{ name: string; client: string; address: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const value = draft ?? { name: project.name, client: project.client, address: project.address };
  const set = (patch: Partial<typeof value>) => setDraft({ ...value, ...patch });

  const save = () => {
    const parsed = projectDetailsSchema.safeParse(value);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    updateProjectDetails(project, parsed.data);
    setDraft(null);
    setErrors({});
    toast('Project details saved.', 'success');
  };

  if (!canEdit) {
    return (
      <Card>
        <T variant="bodyStrong">{project.name}</T>
        <T variant="meta" color="textMuted">
          {project.client}
        </T>
        <T variant="meta" color="textMuted">
          {project.address}
        </T>
      </Card>
    );
  }
  return (
    <View>
      <Field label="Project name" error={errors.name}>
        <Input value={value.name} onChangeText={(name) => set({ name })} />
      </Field>
      <Field label="Client" error={errors.client}>
        <Input value={value.client} onChangeText={(client) => set({ client })} />
      </Field>
      <Field label="Site address" error={errors.address}>
        <Input value={value.address} onChangeText={(address) => set({ address })} multiline />
      </Field>
      {draft ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Save details" onPress={save} />
          </View>
          <Button
            kind="secondary"
            full={false}
            label="Cancel"
            onPress={() => {
              setDraft(null);
              setErrors({});
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
