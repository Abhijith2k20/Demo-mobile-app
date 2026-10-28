// Archive / unarchive and delete a project, with their confirmation sheets.
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, type IconName } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Project } from '@/types/models';
import { shortProjectName, type ProjectAccess } from '../../../shared';
import { deleteProject, setProjectArchived } from '../../api';

function ActionRow({ icon, title, subtitle, onPress, danger }: { icon: IconName; title: string; subtitle: string; onPress: () => void; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      <Feather name={icon} size={18} color={danger ? c.danger : c.textMuted} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" color={danger ? 'danger' : 'text'}>
          {title}
        </T>
        <T variant="meta" color="textMuted">
          {subtitle}
        </T>
      </View>
      <Feather name="chevron-right" size={18} color={c.textFaint} />
    </Pressable>
  );
}

export function ProjectLifecycle({ project, access }: { project: Project; access: ProjectAccess }) {
  const { c } = useTheme();
  const [archiving, setArchiving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [typed, setTyped] = useState('');
  const shortName = shortProjectName(project.name);
  if (!access.canArchive && !access.isAdmin) return null;

  return (
    <>
      <View>
        <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
          Project
        </T>
        <Card style={{ padding: 0 }}>
          {access.canArchive ? (
            project.archivedAt ? (
              <ActionRow
                icon="rotate-ccw"
                title="Unarchive project"
                subtitle="Make it active again"
                onPress={() => setProjectArchived(project, false)}
              />
            ) : (
              <ActionRow
                icon="archive"
                title="Archive project"
                subtitle="Read-only. Can be undone."
                onPress={() => setArchiving(true)}
              />
            )
          ) : null}
          {access.isAdmin ? (
            <View style={{ borderTopWidth: access.canArchive ? 1 : 0, borderTopColor: c.border }}>
              <ActionRow
                danger
                icon="trash-2"
                title="Delete project"
                subtitle="Permanent, for everyone."
                onPress={() => {
                  setTyped('');
                  setRemoving(true);
                }}
              />
            </View>
          ) : null}
        </Card>
        {access.isAdmin ? null : (
          <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
            Only the owner or an admin can delete a project.
          </T>
        )}
      </View>

      <Sheet visible={archiving} onClose={() => setArchiving(false)} title={`Archive ${shortName}?`}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          People can still read it, but nobody can post or change anything until it is unarchived. Nothing is deleted.
        </T>
        <Button
          icon="archive"
          label="Archive project"
          onPress={() => {
            setProjectArchived(project, true);
            setArchiving(false);
          }}
        />
        <Button kind="ghost" label="Cancel" onPress={() => setArchiving(false)} />
      </Sheet>

      <Sheet visible={removing} onClose={() => setRemoving(false)} title={`Delete ${shortName}?`}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.md }}>
          All its channels, messages, photos and tasks are removed for everyone. This can&apos;t be undone.
        </T>
        <Field label={`Type ${shortName} to confirm`}>
          <SheetInput value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} placeholder={shortName} />
        </Field>
        <Button
          kind="danger"
          icon="trash-2"
          label="Delete project"
          disabled={typed.trim().toLowerCase() !== shortName.toLowerCase()}
          onPress={() => {
            setRemoving(false);
            deleteProject(project);
            router.dismissTo('/');
          }}
        />
        <Button kind="ghost" label="Cancel" onPress={() => setRemoving(false)} />
      </Sheet>
    </>
  );
}
