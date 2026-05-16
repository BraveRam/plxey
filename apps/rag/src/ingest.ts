import { Inngest } from "inngest";
import { embedMany } from "ai";
import { PDFParse } from "pdf-parse";
import { db } from "./db";
import { documents, documentChunks, tenants, tenantBots } from "@tg-business/db";
import { eq } from "drizzle-orm";
import { downloadFileById } from "@tg-business/storage";
import { decrypt } from "@tg-business/crypto";
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
    const { b2FileId, documentId, tenantId, botId } = event.data as {
      b2FileId: string;
      documentId: string;
      tenantId: string;
      botId: string;
    };

    try {
      const text = await step.run("extract", async () => {
        const pdfBuffer = await downloadFileById(b2FileId);
        const parser = new PDFParse({ data: pdfBuffer as never });
        const result = await parser.getText();
        return result.text.replace(/\0/g, "");
      });

      const modelId = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

      await step.run("process", async () => {
        const chunks = splitText(text);
        const { embeddings } = await embedMany({ model: modelId, values: chunks });
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
        const fileName = doc.fileName ?? "untitled.pdf";

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
      await db
        .update(documents)
        .set({ status: "failed" })
        .where(eq(documents.id, documentId));
      throw err;
    }
  },
);
