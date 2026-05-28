import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Trash2, Upload, CheckCircle2, Clock, XCircle, Loader2, FolderOpen, Ban } from "lucide-react";
import { GlowIcon } from "@/components/GlowIcon";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDocuments,
  useUploadDocument,
  useDeleteDocument,
  useCancelDocument,
} from "@/hooks/api";
import { haptic } from "@/lib/telegram";
import type { DocumentItem } from "@/types";

function DocStatus({ status }: { status: string }) {
  if (status === "ready")
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="destructive">
        <XCircle className="size-3" /> Failed
      </Badge>
    );
  return (
    <Badge variant="warning">
      <Clock className="size-3" /> Processing
    </Badge>
  );
}

export function DocumentsPanel({ botId }: { botId: string }) {
  const { data: docs, isLoading } = useDocuments(botId);
  const upload = useUploadDocument(botId);
  const del = useDeleteDocument(botId);
  const cancel = useCancelDocument(botId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    try {
      await upload.mutateAsync(file);
      haptic.success();
      toast.success("Uploaded — processing");
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const onDelete = (doc: DocumentItem) => {
    setDeleteTarget(doc);
  };

  const onCancel = async (doc: DocumentItem) => {
    setCancelingId(doc.id);
    try {
      await cancel.mutateAsync(doc.id);
      haptic.success();
      toast.success("Canceled");
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await del.mutateAsync(deleteTarget.id);
      haptic.success();
      toast.success("Document deleted");
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  };

  const processingCount =
    docs?.filter((d) => d.status === "processing").length ?? 0;

  return (
    <div className="space-y-4">
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.txt,.md,.docx,.html,application/pdf,text/plain,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={onPick}
      />
      <Button
        size="lg"
        className="w-full"
        disabled={upload.isPending}
        onClick={() => fileInput.current?.click()}
      >
        <Upload /> {upload.isPending ? "Uploading…" : "Upload document"}
      </Button>

      {processingCount > 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {processingCount} document{processingCount > 1 ? "s" : ""} processing —
          this updates automatically.
        </div>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : docs && docs.length > 0 ? (
        <div className="space-y-2">
          {docs.map((doc) => (
            <Card key={doc.id} className="flex items-center gap-3 p-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.fileName}</p>
                <div className="mt-1">
                  <DocStatus status={doc.status} />
                </div>
              </div>
              {doc.status === "processing" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cancel processing"
                  disabled={cancelingId === doc.id}
                  onClick={() => onCancel(doc)}
                >
                  {cancelingId === doc.id ? (
                    <Loader2 className="animate-spin text-destructive" />
                  ) : (
                    <Ban className="text-destructive" />
                  )}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete document"
                  onClick={() => onDelete(doc)}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <GlowIcon icon={FolderOpen} size={84} />
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload PDFs, Word, Markdown, text, or HTML to
            build the bot's knowledge base.
          </p>
        </Card>
      )}

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              Delete "{deleteTarget?.fileName}" and its data. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={del.isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={del.isPending}>
              {del.isPending ? "Deleting…" : "Delete document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
