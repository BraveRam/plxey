import { Inngest } from "inngest";
import { embedMany } from "ai";
import { PDFParse } from "pdf-parse";
import { db } from "./db";
import { documents, documentChunks } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { downloadFileById } from "./b2";
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
    const { b2FileId, documentId, tenantId } = event.data as {
      b2FileId: string;
      documentId: string;
      tenantId: string;
    };

    const pdfBuffer = await step.run("download", () =>
      downloadFileById(b2FileId));

    const text = await step.run("parse", async () => {
      const parser = new PDFParse({ data: pdfBuffer });
      await parser.load();
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
        documentId,
        chunkIndex: i,
        content,
        embedding: embeddings[i] as number[],
        metadata: {},
      }));
      await db.insert(documentChunks).values(rows);
    });

    await step.run("mark-done", async () => {
      await db
        .update(documents)
        .set({ status: "ready" })
        .where(eq(documents.id, documentId));
    });
  },
);
