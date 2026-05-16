import { Inngest } from "inngest";
import { embedMany } from "ai";
import { db } from "./db";
import { documents, documentChunks, tenants, tenantBots } from "@tg-business/db";
import { eq } from "drizzle-orm";
import { downloadFileById } from "@tg-business/storage";
import { decrypt } from "@tg-business/crypto";
import { splitText } from "./chunker";
import { extractText } from "./parsers";

export const inngest = new Inngest({ id: "tg-rag" });

export const processDocument = inngest.createFunction(
  {
    id: "rag/document.ingest",
    concurrency: 5,
    retries: 3,
    triggers: [{ event: "rag/document.ingest" }],
  },
  async ({ event, step }) => {
    const { b2FileId, documentId, tenantId, botId, mimeType } = event.data as {
      b2FileId: string;
      documentId: string;
      tenantId: string;
      botId: string;
      mimeType: string;
    };

    try {
      const text = await step.run("extract", async () => {
        const buffer = await downloadFileById(b2FileId);
        return extractText(buffer, mimeType);
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
      await db
        .update(documents)
        .set({ status: "failed" })
        .where(eq(documents.id, documentId));
      throw err;
    }
  },
);
