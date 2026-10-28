// The project Files tab: every photo and file posted in its channels.
import { Feather } from '@expo/vector-icons';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, Skeleton } from '@/components/basics';
import { PhotoTile } from '@/components/PhotoGrid';
import { T } from '@/components/T';
import { useProjectFiles } from '@/features/projects/hooks';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { type ID } from '@/types/models';

export function ProjectFiles({ projectId }: { projectId: ID }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { files, loading, failed } = useProjectFiles(projectId);
  if (loading) return <Skeleton rows={4} avatar={false} />;
  if (failed) return <EmptyState icon="cloud-off" title="Couldn't load files" hint="They will appear when the connection is back." />;
  if (files.length === 0) return <EmptyState icon="image" title="No files yet" hint="Photos and files shared in this project's channels appear here." />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }}>
        {files.map((f) => (
          <View key={f.key} style={{ width: '33.333%', padding: 3 }}>
            {f.kind === 'photo' && f.photo ? (
              <View style={{ flexDirection: 'row' }}>
                <PhotoTile photo={f.photo} />
              </View>
            ) : (
              <View style={{ aspectRatio: 1, borderRadius: radius.input, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 }}>
                <Feather name="file-text" size={22} color={c.danger} />
                <T variant="meta" numberOfLines={2} style={{ textAlign: 'center', fontSize: 11, lineHeight: 14 }}>
                  {f.name}
                </T>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
