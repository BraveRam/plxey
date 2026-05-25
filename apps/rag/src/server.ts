import { Hono, type Context, type Next } from "hono";
import { serve } from "inngest/hono";
import { inngest, processDocument } from "./ingest";
import { db } from "./db";
import { documents } from "@tg-business/db";
import { eq } from "drizzle-orm";
import { uploadFile } from "@tg-business/storage";

const SUPPORTED_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
]);

/**
 * Hard ceiling on raw upload bodies for `/upload-and-ingest`. Anything
 * past this is rejected before the body is materialised in memory so
 * the worker can't be DoS'd by an oversized POST. Mirrors the per-bot
 * doc-size limit enforced upstream in `apps/bot`, with headroom.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Shared secret between the bot service and the RAG worker. The bot
 * sends it as `X-Internal-Secret` from `apps/bot/src/lib/doc-ingest.ts`;
 * the RAG worker rejects every mutating route without a matching value.
 *
 * Refuse to start if the env var is missing in production so a misconfig
 * doesn't quietly downgrade the worker to anonymous-write. Dev (local
 * INNGEST_DEV=1) is allowed to skip it for fast iteration.
 */
const RAG_SHARED_SECRET = process.env.RAG_SHARED_SECRET ?? "";
const DEV_MODE = process.env.INNGEST_DEV === "1";
if (!RAG_SHARED_SECRET && !DEV_MODE) {
  throw new Error(
    "RAG_SHARED_SECRET is required in production. Set it to a long random " +
      "string and provide the same value to the bot service.",
  );
}

/**
 * Constant-time header check. Returns true when the secret matches.
 * Empty server-side secret only matches when DEV_MODE is true.
 */
function requireSharedSecret(c: Context): Response | null {
  if (DEV_MODE && RAG_SHARED_SECRET === "") return null;
  const got = c.req.header("X-Internal-Secret") ?? "";
  if (got.length !== RAG_SHARED_SECRET.length) {
    return c.json({ error: "forbidden" }, 403);
  }
  let mismatch = 0;
  for (let i = 0; i < got.length; i++) {
    mismatch |= got.charCodeAt(i) ^ RAG_SHARED_SECRET.charCodeAt(i);
  }
  return mismatch === 0 ? null : c.json({ error: "forbidden" }, 403);
}

const sharedSecretMiddleware = async (c: Context, next: Next) => {
  const denied = requireSharedSecret(c);
  if (denied) return denied;
  await next();
};

const app = new Hono();

const handler = serve({ client: inngest, functions: [processDocument] });
app.all("/api/inngest", async (c) => handler(c));

app.post("/ingest", sharedSecretMiddleware, async (c) => {
  try {
    const { b2FileId, b2FileName, tenantId, botId, fileName, mimeType } = await c.req.json<{
      b2FileId: string;
      b2FileName?: string;
      tenantId: string;
      botId: string;
      fileName?: string;
      mimeType?: string;
    }>();

    if (!b2FileId || !tenantId || !botId) {
      return c.json({ error: "b2FileId, tenantId, and botId required" }, 400);
    }

    const mime = mimeType ?? "application/pdf";
    if (!SUPPORTED_MIMES.has(mime)) {
      return c.json({ error: `Unsupported mimeType: ${mime}` }, 400);
    }

    const [doc] = await db
      .insert(documents)
      .values({
        tenantId,
        tenantBotId: botId,
        fileName: fileName ?? "unknown",
        mimeType: mime,
        status: "processing",
        source: "upload",
        b2FileId,
        b2FileName: b2FileName ?? null,
      })
      .returning();

    await inngest.send({
      name: "rag/document.ingest",
      data: { b2FileId, documentId: doc!.id, tenantId, botId, mimeType: mime },
    });

    return c.json({ documentId: doc!.id, status: "queued" }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});

app.get("/ingest/:documentId", sharedSecretMiddleware, async (c) => {
  const docId = c.req.param("documentId");
  if (!docId) return c.json({ error: "documentId required" }, 400);
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, docId),
  });
  if (!doc) return c.json({ error: "not found" }, 404);

  return c.json({
    documentId: doc.id,
    fileName: doc.fileName,
    status: doc.status,
    createdAt: doc.createdAt,
  });
});

app.post("/upload-and-ingest", sharedSecretMiddleware, async (c) => {
  try {
    // Reject oversized uploads before reading the body. Content-Length is
    // mandatory here so an attacker can't chunk past the cap or stream
    // forever to exhaust memory.
    const contentLengthHeader = c.req.header("Content-Length");
    if (!contentLengthHeader) {
      return c.json({ error: "Content-Length required" }, 411);
    }
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAX_UPLOAD_BYTES
    ) {
      return c.json(
        { error: `payload too large (max ${MAX_UPLOAD_BYTES} bytes)` },
        413,
      );
    }

    const buffer = await c.req.arrayBuffer();
    // Belt-and-suspenders: the underlying buffer length must agree with
    // the header we just trusted. If they disagree the client lied.
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ error: "payload too large" }, 413);
    }

    const contentDisposition = c.req.header("Content-Disposition") ?? "";
    const fileName =
      contentDisposition.match(/filename="?(.+?)"?$/)?.[1] ?? `upload-${crypto.randomUUID()}.pdf`;
    const tenantId = c.req.header("X-Tenant-Id");
    if (!tenantId) return c.json({ error: "X-Tenant-Id header required" }, 400);
    const botId = c.req.header("X-Bot-Id");
    if (!botId) return c.json({ error: "X-Bot-Id header required" }, 400);
    const mime = c.req.header("Content-Type")?.split(";")[0]?.trim() ?? "application/pdf";
    if (!SUPPORTED_MIMES.has(mime)) {
      return c.json({ error: `Unsupported Content-Type: ${mime}` }, 400);
    }

    const bucketId = process.env.B2_BUCKET_ID;
    if (!bucketId) return c.json({ error: "B2_BUCKET_ID not configured" }, 500);

    const { fileId, fileName: b2FileName } = await uploadFile(bucketId, `tenants/${tenantId}/docs/${crypto.randomUUID()}`, Buffer.from(buffer), mime);

    const [doc] = await db
      .insert(documents)
      .values({
        tenantId,
        tenantBotId: botId,
        fileName,
        mimeType: mime,
        status: "processing",
        source: "upload",
        b2FileId: fileId,
        b2FileName,
      })
      .returning();

    await inngest.send({
      name: "rag/document.ingest",
      data: { b2FileId: fileId, documentId: doc!.id, tenantId, botId, mimeType: mime },
    });

    return c.json({ documentId: doc!.id, status: "queued" }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});

const port = Number(process.env.RAG_PORT || 3001);
Bun.serve({ fetch: app.fetch, port });
console.log(`RAG worker running on :${port}`);
