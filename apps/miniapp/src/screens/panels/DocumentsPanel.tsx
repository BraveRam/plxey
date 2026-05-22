import { useRef } from "react";
import { toast } from "sonner";
import { FileText, Trash2, Upload, CheckCircle2, Clock, XCircle, Loader2, FolderOpen } from "lucide-react";
import { GlowIcon } from "@/components/GlowIcon";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/api";
import { haptic, confirm } from "@/lib/telegram";
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
  const fileInput = useRef<HTMLInputElement>(null);

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

  const onDelete = async (doc: DocumentItem) => {
    const ok = await confirm(`Delete "${doc.fileName}" and its data?`);
    if (!ok) return;
    try {
      await del.mutateAsync(doc.id);
      haptic.success();
      toast.success("Document deleted");
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Delete failed");
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
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete document"
                onClick={() => onDelete(doc)}
              >
                <Trash2 className="text-destructive" />
              </Button>
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
    </div>
  );
}
