// "Browse channels": public channels of a project that the user has not joined yet.
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Button, EmptyState, Skeleton } from '@/components/basics';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { api } from '@/lib/api/client';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Channel, ID } from '@/types/models';
import { joinChannel } from '../api';
import { useProjectChannels } from '../hooks';

type Listed = Channel & { joined: boolean; memberCount: number };

export function BrowseChannels({ projectId, visible, onClose }: { projectId: ID; visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const mine = useProjectChannels(projectId);
  // Not offline data: the list of channels you are *not* in only exists on the server.
  const q = useQuery({
    queryKey: ['project-channels', projectId],
    queryFn: async () => (await api<{ channels: Listed[] }>('GET', `/projects/${projectId}/channels`)).channels,
    enabled: visible,
    staleTime: 0,
  });
  const joinedIds = new Set(mine.map((ch) => ch.id));
  const open = (q.data ?? []).filter((ch) => !ch.isPrivate && !joinedIds.has(ch.id));

  return (
    <Sheet visible={visible} onClose={onClose} title="Browse channels" subtitle="Public channels in this project you can join">
      {q.isLoading ? (
        <Skeleton rows={2} avatar={false} />
      ) : q.isError ? (
        <EmptyState icon="cloud-off" title="Couldn't load channels" hint="Check the connection and try again." action={<Button small full={false} kind="secondary" label="Try again" onPress={() => void q.refetch()} />} />
      ) : open.length === 0 ? (
        <EmptyState icon="check-circle" title="You're in every channel you can join" hint="Private channels are by invitation from a manager." />
      ) : (
        open.map((ch) => (
          <View key={ch.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 }}>
            <Feather name="hash" size={16} color={c.textMuted} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong" numberOfLines={1}>
                {ch.name}
              </T>
              <T variant="meta" color="textMuted">
                {ch.memberCount} {ch.memberCount === 1 ? 'person' : 'people'}
              </T>
            </View>
            <Button small full={false} label="Join" onPress={() => joinChannel(ch)} />
          </View>
        ))
      )}
    </Sheet>
  );
}
