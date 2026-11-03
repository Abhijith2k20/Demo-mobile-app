// The project Info tab: client and address, and its channels.
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Card, Row } from '@/components/basics';
import { T } from '@/components/T';
import { BrowseChannels } from '@/features/projects/components/BrowseChannels';
import { useProjectChannels } from '@/features/projects/hooks';
import { useProjectAccess, useUnreadCounts } from '@/features/shared';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ProjectView } from '@/types/models';


export function ProjectInfo({ project }: { project: ProjectView }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useProjectAccess(project.id);
  const channels = useProjectChannels(project.id);
  const unread = useUnreadCounts();
  const [browse, setBrowse] = useState(false);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <View>
        <T variant="title">{project.name}</T>
        {project.client ? (
          <T variant="meta" color="textMuted">
            {project.client}
          </T>
        ) : null}
        {project.address ? (
          <T variant="meta" color="textMuted">
            {project.address}
          </T>
        ) : null}
      </View>

      <View>
        <T variant="label" color="textMuted" style={{ marginBottom: space.xs }}>
          Channels
        </T>
        <Card style={{ padding: 0 }}>
          {channels.map((ch, i) => (
            <View key={ch.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
              <Row
                left={ch.isPrivate ? <Feather name="lock" size={15} color={c.textMuted} /> : <T color="textMuted">#</T>}
                title={ch.name}
                strong={(unread.get(ch.id) ?? 0) > 0}
                right={
                  (unread.get(ch.id) ?? 0) > 0 ? (
                    <Badge count={unread.get(ch.id) ?? 0} />
                  ) : (
                    <Feather name="chevron-right" size={18} color={c.textFaint} />
                  )
                }
                onPress={() => router.push(`/channel/${ch.id}`)}
              />
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <Row
              left={<Feather name="compass" size={15} color={c.textMuted} />}
              title="Browse channels"
              muted
              right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
              onPress={() => setBrowse(true)}
            />
          </View>
          {access.canArchive || access.isAdmin || access.can('channel.manage') ? (
            <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
              <Row
                left={<Feather name="settings" size={15} color={c.textMuted} />}
                title="Project settings"
                muted
                right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
                onPress={() => router.push(`/project/${project.id}/settings`)}
              />
            </View>
          ) : null}
        </Card>
      </View>
      <BrowseChannels projectId={project.id} visible={browse} onClose={() => setBrowse(false)} />
      {access.canArchive || access.isAdmin || access.can('channel.manage') ? (
        <T variant="meta" color="textFaint" style={{ marginTop: -space.sm }}>
          Project settings: edit details, add people, add or delete channels and pick who is in them, archive or delete the project.
        </T>
      ) : null}

    </ScrollView>
  );
}
