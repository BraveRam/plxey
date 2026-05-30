import { Inngest, NonRetriableError } from "inngest";
import { embedMany } from "ai";
import { db } from "./db";
import { documents, documentChunks, tenants, tenantBots } from "@tg-business/db";
import { eq } from "drizzle-orm";
import { downloadFileById } from "@tg-business/storage";
import { decrypt } from "@tg-business/crypto";
import { splitText } from "./chunker";
import { batchRows } from "./batch";
import { extractText } from "./parsers";

export const inngest = new Inngest({ id: "tg-rag" });

// Embed + insert chunks in bounded batches. Each row carries a 1536-dim
// vector (~24KB as text); a single insert of every chunk builds one
// multi-MB statement that can exceed the Neon HTTP request-size limit (seen
// in prod as a "Failed query" on document_chunks for a multi-MB upload).
// 50 rows ≈ ~1.2MB/request — comfortably under the driver + embeddings-API
// limits.
const INGEST_BATCH_SIZE = 50;

// Hard ceiling on chunks per document. Past this we fail the ingest cleanly
// (status=failed, no retry) rather than spend minutes embedding a
// pathological upload. 5000 chunks ≈ ~2.5MB of extracted text — far beyond
// any real support document.
const MAX_CHUNKS = 5000;

export const processDocument = inngest.createFunction(
  {
    id: "rag/document.ingest",
    concurrency: 5,
    retries: 3,
    triggers: [{ event: "rag/document.ingest" }],
    // Owner-initiated cancel: a `rag/document.cancel` event whose
    // `data.documentId` matches this run's triggering event aborts the
    // run at the next step boundary. The bot emits it from the Mini App
    // cancel button via the worker's /cancel route.
    cancelOn: [{ event: "rag/document.cancel", match: "data.documentId" }],
  },
  async ({ event, step }) => {
    const { b2FileId, documentId, tenantId, botId, mimeType } = event.data as {
      b2FileId: string;
      documentId: string;
      tenantId: string;
      botId: string;
      mimeType: string;
    };

    // Read the row's current status as the first step. If it's already
    // gone (deleted by a cancel that raced ahead of `cancelOn`) or no
    // longer "processing", bail before spending a B2 download / embeds.
    const stillLive = await step.run("check-live", async () => {
      const d = await db.query.documents.findFirst({
        where: eq(documents.id, documentId),
        columns: { status: true },
      });
      return d?.status === "processing";
    });
    if (!stillLive) return;

    try {
      const text = await step.run("extract", async () => {
        const buffer = await downloadFileById(b2FileId);
        return extractText(buffer, mimeType);
      });

      const modelId = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

      await step.run("process", async () => {
        const chunks = splitText(text);
        if (chunks.length > MAX_CHUNKS) {
          // Deterministic: retrying won't shrink the doc, so fail fast.
          throw new NonRetriableError(
            `document too large: ${chunks.length} chunks (max ${MAX_CHUNKS})`,
          );
        }

        for (const { start, slice } of batchRows(chunks, INGEST_BATCH_SIZE)) {
          // Re-check per batch: `cancelOn` only aborts between Inngest steps,
          // and this whole loop is one step. A cancel/delete that lands
          // mid-ingest must stop here so we don't keep writing chunks for a
          // canceled doc or hit a FK violation if the row was deleted.
          const live = await db.query.documents.findFirst({
            where: eq(documents.id, documentId),
            columns: { status: true },
          });
          if (live?.status !== "processing") return;

          const { embeddings } = await embedMany({ model: modelId, values: slice });
          const rows = slice.map((content, j) => ({
            tenantId,
            tenantBotId: botId,
            documentId,
            chunkIndex: start + j,
            content,
            embedding: JSON.stringify(embeddings[j] as number[]),
            metadata: {},
          })) as unknown as (typeof documentChunks.$inferInsert)[];
          // onConflictDoNothing keeps batches idempotent: if the step retries
          // after some batches already inserted, re-inserting the same
          // (documentId, chunkIndex) rows is a no-op instead of a unique
          // violation against document_chunks_doc_chunk_uq.
          try {
            await db.insert(documentChunks).values(rows).onConflictDoNothing();
          } catch (insertErr) {
            // Capture the real driver cause at the point of failure — the
            // outer catch only sees it after retries exhaust, and the
            // DrizzleQueryError message hides it behind the SQL + params.
            const cause =
              insertErr instanceof Error ? insertErr.cause : undefined;
            const dims = Array.isArray(embeddings[0])
              ? (embeddings[0] as number[]).length
              : null;
            console.error(
              JSON.stringify({
                msg: "chunk_insert_failed",
                documentId,
                batchStart: start,
                rows: rows.length,
                embeddingDims: dims,
                cause:
                  cause instanceof Error
                    ? cause.message
                    : cause !== undefined
                      ? String(cause).slice(0, 400)
                      : insertErr instanceof Error
                        ? insertErr.message?.slice(0, 400)
                        : String(insertErr),
              }),
            );
            throw insertErr;
          }
        }
      });

      await step.run("finish", async () => {
        await db
          .update(documents)
          .set({ status: "ready" })
          .where(eq(documents.id, documentId));

        const doc = await db.query.documents.findFirst({
          where: eq(documents.id, documentId),
        });
        if (!doc) return;

        const tenantRow = await db.query.tenants.findFirst({
          where: eq(tenants.id, doc.tenantId),
        });
        const ownerId = tenantRow?.telegramOwnerId;

        const botRow = await db.query.tenantBots.findFirst({
          where: eq(tenantBots.id, botId),
        });
        if (!ownerId || !botRow) return;

        const botToken = await decrypt(botRow.botTokenEncrypted);
        const fileName = doc.fileName ?? "untitled";

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(ownerId),
            text: `✅ Document "${fileName}" processed and ready for answering questions.`,
          }),
        });
      });
    } catch (err) {
      // Surface the real driver error. A DrizzleQueryError's message is just
      // the SQL + params (huge, and hides the reason); the actual Neon/
      // Postgres cause lives on `.cause` and was previously lost on rethrow,
      // leaving ingest failures undiagnosable in the worker logs.
      const cause = err instanceof Error ? err.cause : undefined;
      console.error(
        JSON.stringify({
          msg: "ingest failed",
          documentId,
          error:
            err instanceof Error ? err.message?.slice(0, 500) : String(err),
          cause:
            cause instanceof Error
              ? cause.message
              : cause !== undefined
                ? String(cause)
                : undefined,
        }),
      );
      await db
        .update(documents)
        .set({ status: "failed" })
        .where(eq(documents.id, documentId));
      throw err;
    }
  },
);
