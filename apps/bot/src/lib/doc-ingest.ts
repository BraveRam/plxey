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

  const workUrl = process.env.WORKER_URL;
  if (!workUrl) throw new Error("WORKER_URL not configured");

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
    headers: { "Content-Type": "application/json" },
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
