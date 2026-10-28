import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get, keys } from '@/lib/queries';
import type { Attachment, ChannelView, ID, MessageView } from '@/types/models';
import { useChannels } from '../shared';


/** The project's channels the user can read, in standard order. */
export function useProjectChannels(projectId: ID | null | undefined): ChannelView[] {
  const channels = useChannels();
  return useMemo(() => channels.list.filter((c) => c.projectId === projectId), [channels.list, projectId]);
}

/** Which of the project's channels each person is in. */
export function useChannelMembership(projectId: ID | null | undefined): Map<ID, ID[]> {
  const list = useProjectChannels(projectId);
  return useMemo(() => {
    const map = new Map<ID, ID[]>();
    for (const c of list) for (const uid of c.memberIds) map.set(uid, [...(map.get(uid) ?? []), c.id]);
    return map;
  }, [list]);
}

/** Every channel in a project the user may know about, joined or not ("Browse channels"). */
export function useBrowseChannels(projectId: ID, enabled = true) {
  return useQuery({
    queryKey: keys.browse(projectId),
    queryFn: get<{ channels: ChannelView[] }>(`/projects/${projectId}/channels`),
    enabled,
  });
}

/** Last few status cards (check-in results, escalations) across the project's channels. */
export function useRecentUpdates(projectId: ID | null | undefined): MessageView[] {
  const q = useQuery({
    queryKey: keys.updates(projectId ?? ''),
    queryFn: get<{ messages: MessageView[] }>(`/projects/${projectId}/updates`),
    enabled: !!projectId,
  });
  return q.data?.messages ?? [];
}

export interface ProjectFile {
  key: string;
  kind: 'photo' | 'file';
  photo?: Attachment;
  name?: string;
  at: string;
  senderId: ID;
}

/** Every photo and file posted in the project's channels, newest first. */
export function useProjectFiles(projectId: ID | null | undefined): { files: ProjectFile[]; loading: boolean; failed: boolean } {
  const q = useQuery({
    queryKey: keys.files(projectId ?? ''),
    queryFn: get<{ files: ProjectFile[] }>(`/projects/${projectId}/files`),
    enabled: !!projectId,
  });
  return { files: q.data?.files ?? [], loading: q.isPending && !q.isError, failed: q.isError && !q.data };
}
