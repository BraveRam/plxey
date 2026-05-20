import { Hono } from "hono";
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

const app = new Hono();

// Shared secret authentication between bot and rag services.
app.use("/ingest", async (c, next) => {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error("INTERNAL_API_SECRET not set");
    return c.json({ error: "Internal Server Error" }, 500);
  }
  if (c.req.header("X-Internal-Secret") !== secret) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const handler = serve({ client: inngest, functions: [processDocument] });
app.all("/api/inngest", async (c) => handler(c));

app.post("/ingest", async (c) => {
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

app.get("/ingest/:documentId", async (c) => {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, c.req.param("documentId")),
  });
  if (!doc) return c.json({ error: "not found" }, 404);

  return c.json({
    documentId: doc.id,
    fileName: doc.fileName,
    status: doc.status,
    createdAt: doc.createdAt,
  });
});

app.post("/upload-and-ingest", async (c) => {
  try {
    const buffer = await c.req.arrayBuffer();
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
