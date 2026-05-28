import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PublicBot } from "@/types";

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
