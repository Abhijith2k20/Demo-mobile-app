// Project name with a sheet to switch between the user's projects.
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID, Project } from '@/types/models';

export function ProjectSwitcher({ projects, current, onPick }: { projects: Project[]; current: Project; onPick: (id: ID) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project: ${current.name}. Change`}
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: touch.min }}>
        <T variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
          {current.name.split(' – ')[0]}
        </T>
        <Feather name="chevron-down" size={18} color={c.textMuted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Switch project">
        {projects.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => {
              onPick(p.id);
              setOpen(false);
            }}
            style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Feather name={p.id === current.id ? 'check-circle' : 'circle'} size={18} color={p.id === current.id ? c.accent : c.textFaint} />
            <T variant={p.id === current.id ? 'bodyStrong' : 'body'} style={{ flex: 1 }} numberOfLines={1}>
              {p.name}
            </T>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}
