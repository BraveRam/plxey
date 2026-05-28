/**
 * Shared document ingest path: upload bytes to B2, then trigger the RAG
 * worker's `/ingest`. Used by both the bot's batch-upload conversation
 * (`registry.ts`) and the Mini App upload route (`api/routes.ts`) so the
 * B2 layout, ingest payload, and error handling stay in one place.
 *
 * Callers are responsible for the checks that precede ingest (quota,
 * size, MIME, per-bot cap) — this only performs the side effects once a
 * file is approved.
 */

import { randomUUID } from "crypto";
import { uploadFile, b2BucketId } from "@tg-business/storage";
import { logger } from "./logger";

/**
 * Resolve the RAG worker base URL + auth headers, or throw if misconfigured.
 *
 * The RAG worker rejects unauthenticated traffic on every mutating route.
 * The two services share `RAG_SHARED_SECRET` out-of-band (set on both Koyeb
 * services). Fail loudly here rather than letting the worker reject with a
 * 403 the operator has to dig out of logs. Dev (`INNGEST_DEV=1`) may run
 * without the secret.
 */
function ragWorker(): { workUrl: string; headers: Record<string, string> } {
  const workUrl = process.env.WORKER_URL;
  if (!workUrl) throw new Error("WORKER_URL not configured");
  const ragSecret = process.env.RAG_SHARED_SECRET;
  if (!ragSecret && process.env.INNGEST_DEV !== "1") {
    throw new Error("RAG_SHARED_SECRET not configured");
  }
  return {
    workUrl,
    headers: {
      "Content-Type": "application/json",
      ...(ragSecret ? { "X-Internal-Secret": ragSecret } : {}),
    },
  };
}

export interface IngestDocumentArgs {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  tenantId: string;
  botId: string;
}

/**
 * Upload `buffer` to B2 under `tenants/{tenantId}/docs/{uuid}.{ext}` and
 * POST the resulting B2 reference to `{WORKER_URL}/ingest`. Returns the
 * `documentId` created by the worker. Throws on any failure (missing
 * WORKER_URL, B2 error, non-OK ingest response).
 */
export async function ingestDocument(
  args: IngestDocumentArgs,
): Promise<{ documentId: string }> {
  const { buffer, fileName, mimeType, tenantId, botId } = args;

  const { workUrl, headers } = ragWorker();

  const ext = fileName.split(".").pop()?.toLowerCase();
  const b2Path = `tenants/${tenantId}/docs/${randomUUID()}${ext ? `.${ext}` : ""}`;
  const { fileId, fileName: b2FileName } = await uploadFile(
    b2BucketId(),
    b2Path,
    buffer,
    mimeType,
  );

  const ingestRes = await fetch(`${workUrl}/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      b2FileId: fileId,
      b2FileName,
      tenantId,
      botId,
      fileName,
      mimeType,
    }),
  });

  if (!ingestRes.ok) {
    const errBody = await ingestRes.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? "ingest failed");
  }

  const ingestBody = (await ingestRes.json()) as { documentId: string };
  logger.info(
    { documentId: ingestBody.documentId, fileName, mimeType },
    "document queued for processing",
  );
  return { documentId: ingestBody.documentId };
}

/**
 * Signal the RAG worker to cancel an in-flight ingest for `documentId`.
 * Emits `rag/document.cancel`, which aborts a running `processDocument`
 * via its `cancelOn` rule. The caller is responsible for the DB/B2
 * cleanup afterwards (see the Mini App cancel route, which reuses
 * `deleteDocument`). Throws on misconfig or a non-OK worker response.
 */
export async function cancelDocumentIngest(documentId: string): Promise<void> {
  const { workUrl, headers } = ragWorker();

  const res = await fetch(`${workUrl}/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ documentId }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? "cancel failed");
  }
  logger.info({ documentId }, "document ingest cancel requested");
}
