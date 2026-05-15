import { Inngest } from "inngest";
import { embedMany } from "ai";
import { PDFParse } from "pdf-parse";
import { db } from "./db";
import { documents, documentChunks, tenants } from "@tg-business/db";
import { eq } from "drizzle-orm";
import { downloadFileById } from "@tg-business/storage";
import { splitText } from "./chunker";

export const inngest = new Inngest({ id: "tg-rag" });

export const processPdf = inngest.createFunction(
  {
    id: "rag/pdf.ingest",
    concurrency: 5,
    retries: 3,
    triggers: [{ event: "rag/pdf.ingest" }],
  },
  async ({ event, step }) => {
    const { b2FileId, documentId, tenantId, botId, botToken } = event.data as {
      b2FileId: string;
      documentId: string;
      tenantId: string;
      botId: string;
      botToken: string;
    };

    const pdfBuffer = await step.run("download", () =>
      downloadFileById(b2FileId));

    const text = await step.run("parse", async () => {
      const parser = new PDFParse({ data: pdfBuffer as never });
      const result = await parser.getText();
      return result.text;
    });

    const chunks = await step.run("chunk", () =>
      splitText(text));

    const modelId = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

    const { embeddings } = await step.run("embed", () =>
      embedMany({ model: modelId, values: chunks }));

    await step.run("store", async () => {
      const rows = chunks.map((content, i) => ({
        tenantId,
        tenantBotId: botId,
        documentId,
        chunkIndex: i,
        content,
        embedding: JSON.stringify(embeddings[i] as number[]),
        metadata: {},
      })) as unknown as (typeof documentChunks.$inferInsert)[];
      await db.insert(documentChunks).values(rows);
    });

    await step.run("mark-done", async () => {
      await db
        .update(documents)
        .set({ status: "ready" })
        .where(eq(documents.id, documentId));
    });

    await step.run("notify", async () => {
      const doc = await db.query.documents.findFirst({
        where: eq(documents.id, documentId),
      });

      const ownerId = doc?.tenantId
        ? (await db.query.tenants.findFirst({ where: eq(tenants.id, doc.tenantId) }))?.telegramOwnerId
        : null;
      const fileName = doc?.fileName ?? "untitled.pdf";
      if (!ownerId || !botToken) return;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(ownerId),
          text: `✅ Document "${fileName}" processed and ready for answering questions.`,
        }),
      });
    });
  },
);
