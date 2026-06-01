import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { PublicBot } from "@/types";

/** Don't retry auth/permission denials — only flaky/5xx errors. */
function retryUnlessAuth(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return false;
  }
  return failureCount < 2;
}

export function useBots() {
  return useQuery({ queryKey: ["bots"], queryFn: api.listBots });
}

export function useBot(id: string | undefined) {
  const bots = useBots();
  return bots.data?.find((b) => b.id === id);
}

export function useBilling() {
  return useQuery({ queryKey: ["billing"], queryFn: api.billing });
}

/** Caller's admin status — gates the home-screen admin entry button. Cached
 * long: it never changes within a session. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: Infinity,
  });
}

export function useDocuments(botId: string | undefined) {
  return useQuery({
    queryKey: ["documents", botId],
    queryFn: () => api.listDocuments(botId!),
    enabled: !!botId,
    // Poll while anything is still processing so status flips to ready.
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === "processing") ? 4000 : false,
  });
}

export function useAnalytics(botId: string | undefined) {
  return useQuery({
    queryKey: ["analytics", botId],
    queryFn: () => api.analytics(botId!),
    enabled: !!botId,
  });
}

export function usePermissions(botId: string | undefined) {
  return useQuery({
    queryKey: ["permissions", botId],
    queryFn: () => api.permissions(botId!),
    enabled: !!botId,
  });
}

export function useAdminMetrics(range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["admin", "metrics", range.from ?? "", range.to ?? ""],
    queryFn: () => api.adminMetrics(range),
    retry: retryUnlessAuth,
    // Server caches ~60s; mirror that so re-selecting a range is instant.
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useAdminOwners(search: string, page: number) {
  return useQuery({
    queryKey: ["admin", "owners", search, page],
    queryFn: () => api.adminOwners(search, page),
    retry: retryUnlessAuth,
    // Keep the previous page/results visible while typing or paging so the
    // table doesn't flash empty between keystrokes.
    placeholderData: keepPreviousData,
  });
}

export function useAdminOwnerDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "owner", id],
    queryFn: () => api.adminOwnerDetail(id!),
    enabled: !!id,
    retry: retryUnlessAuth,
  });
}

export function useUpdateBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      patch: Parameters<typeof api.updateBot>[1];
    }) => api.updateBot(args.id, args.patch),
    onSuccess: (updated) => {
      qc.setQueryData<PublicBot[]>(["bots"], (old) =>
        old?.map((b) => (b.id === updated.id ? updated : b)),
      );
    },
  });
}

export function useCreateBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.createBot(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
}

export function useDeleteBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
}

export function useRestartBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restartBot(id),
    // Refetch bots so the (possibly flipped) status + refreshed username show.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
}

export function useUploadDocument(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadDocument(botId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", botId] }),
  });
}

export function useDeleteDocument(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", botId] }),
  });
}

export function useCancelDocument(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", botId] }),
  });
}
