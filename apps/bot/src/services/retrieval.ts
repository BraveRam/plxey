import { embed } from "ai";
import { db } from "@tg-business/db";
import { documentChunks } from "@tg-business/db";
import { sql, eq, and, gt, desc } from "drizzle-orm";

export async function findRelevantContent(
  query: string,
  botId: string,
): Promise<{ content: string; similarity: number }[]> {
  const { embedding } = await embed({
    model: process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    value: query,
  });

  const embeddingStr = `[${embedding.join(",")}]`;
  const distance = sql<number>`1 - (embedding <=> ${embeddingStr}::vector)`;

  const rows = await db
    .select({
      content: documentChunks.content,
      similarity: distance,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.tenantBotId, botId),
        gt(distance, 0.3),
      ),
    )
    .orderBy(desc(distance))
    .limit(5);

  return rows;
}
