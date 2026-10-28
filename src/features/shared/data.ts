// Shared server data: people, projects, channels, unread counts, refresh.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import { get, keys, refreshAll } from '@/lib/queries';
import type { ChannelView, Company, ID, Meta, ProjectMember, ProjectRole, ProjectView, User, UserView } from '@/types/models';

export function useMeta(): Meta | undefined {
  return useQuery({ queryKey: keys.meta, queryFn: get<Meta>('/meta'), staleTime: Infinity }).data;
}

/** The workspace's name; needs no sign-in, so the login screen can show it too. */
export function useCompany(): Company | undefined {
  return useQuery({ queryKey: keys.company, queryFn: get<Company>('/company'), staleTime: Infinity }).data;
}

/** Whether a project role is always in every channel (the server's rule, from /meta). */
export function useInEveryChannel(): (role: ProjectRole) => boolean {
  const roles = useMeta()?.rolesInEveryChannel;
  return useCallback((role: ProjectRole) => roles?.includes(role) ?? false, [roles]);
}

/** Everyone in the company, deactivated people included (they keep their history). */
export function useUsers(): { list: UserView[]; byId: Map<ID, UserView>; loading: boolean } {
  const q = useQuery({ queryKey: keys.users, queryFn: async () => (await api<{ users: UserView[] }>('GET', '/users')).users });
  return useMemo(() => {
    const list = q.data ?? [];
    return { list, byId: new Map(list.map((u) => [u.id, u])), loading: q.isPending };
  }, [q.data, q.isPending]);
}

export function useProjects(): { list: ProjectView[]; byId: Map<ID, ProjectView>; loading: boolean; failed: boolean } {
  const q = useQuery({
    queryKey: keys.projects,
    queryFn: async () => (await api<{ projects: ProjectView[] }>('GET', '/projects')).projects,
  });
  return useMemo(() => {
    const list = q.data ?? [];
    return { list, byId: new Map(list.map((p) => [p.id, p])), loading: q.isPending, failed: q.isError };
  }, [q.data, q.isPending, q.isError]);
}

export function useProject(id: ID | null | undefined): ProjectView | null {
  return useProjects().byId.get(id ?? '') ?? null;
}

export function useChannels(): { list: ChannelView[]; byId: Map<ID, ChannelView>; loading: boolean } {
  const q = useQuery({
    queryKey: keys.channels,
    queryFn: async () => (await api<{ channels: ChannelView[] }>('GET', '/channels')).channels,
  });
  return useMemo(() => {
    const list = q.data ?? [];
    return { list, byId: new Map(list.map((c) => [c.id, c])), loading: q.isPending };
  }, [q.data, q.isPending]);
}

export function useAllProjectMembers(): ProjectMember[] {
  const projects = useProjects();
  return useMemo(() => projects.list.flatMap((p) => p.members), [projects.list]);
}

export interface MemberRow {
  member: ProjectMember;
  user: User;
}

/** The project's members, managers first. Deactivated people keep their history but aren't listed. */
export function useProjectMembers(projectId: ID | null | undefined): MemberRow[] {
  const project = useProject(projectId);
  const users = useUsers();
  return useMemo(() => {
    const rows: MemberRow[] = [];
    for (const member of project?.members ?? []) {
      const user = users.byId.get(member.userId);
      if (user?.isActive) rows.push({ member, user });
    }
    return rows.sort((a, b) => a.member.role.localeCompare(b.member.role) || a.user.name.localeCompare(b.user.name));
  }, [project?.members, users.byId]);
}

/** Unread message count per channel, as counted by the server. */
export function useUnreadCounts(): Map<ID, number> {
  const channels = useChannels();
  return useMemo(() => new Map(channels.list.map((c) => [c.id, c.unreadCount])), [channels.list]);
}

/** Pull-to-refresh: fetch everything on screen again. */
export function useRefresh(): { refreshing: boolean; refresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    void refreshAll().finally(() => setRefreshing(false));
  }, []);
  return { refreshing, refresh };
}
