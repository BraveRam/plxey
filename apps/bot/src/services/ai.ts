import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { logger } from "../lib/logger";
import { findRelevantContent } from "./retrieval";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface SendAdminMessageResult {
  ok: boolean;
  error?: string;
}

interface AskAIOptions {
  tenantId: string;
  sendAdminMessage?: (input: { message: string; reason: string }) => Promise<SendAdminMessageResult>;
}

export async function askAI(
  question: string,
  businessName: string,
  systemPrompt: string,
  history: HistoryEntry[] = [],
  options: AskAIOptions,
): Promise<{ text: string | null }> {
  const tools = {
    ...(options.sendAdminMessage ? {
      send_admin_message: tool({
        description:
          "Send a concrete customer message to the human admin. Only call this when you have the exact message text to pass along.",
        inputSchema: z.object({
          message: z.string().describe("The exact customer message to send to the admin"),
          reason: z.string().describe("Why this needs the human admin"),
        }),
        execute: async ({ message, reason }: { message: string; reason: string }) => {
          logger.info({ reason }, "send_admin_message tool called");
          return options.sendAdminMessage!({ message, reason });
        },
      }),
    } : {}),
    get_information: tool({
      description:
        "Search the knowledge base for information relevant to the customer's question. Call this to retrieve context from uploaded documents.",
      inputSchema: z.object({
        query: z.string().describe("The search query based on the customer's question"),
      }),
      execute: async ({ query }: { query: string }) => {
        const results = await findRelevantContent(query, options.tenantId);
        if (results.length === 0) {
          return { found: false, message: "No relevant information found in the knowledge base." };
        }
        return {
          found: true,
          chunks: results.map(r => r.content).join("\n\n---\n\n"),
        };
      },
    }),
  };

  const result = await generateText({
    model: process.env.AI_MODEL || "deepseek/deepseek-v4-flash",
    system:
      systemPrompt.replace("{business_name}", businessName) +
      "\n\nUse the conversation history for context." +
      "\n\nYou have a knowledge base of uploaded documents. When a customer asks a question, call get_information to search for relevant information. Do not guess or make up information." +
      "\n\nIf the customer asks to leave a message for the admin but does not provide the actual message, ask what they would like you to tell the admin. Do not call a tool yet." +
      "\n\nIf the customer gives the actual message to pass to the admin, call send_admin_message with the exact message." +
      "\n\nIf the customer cancels, says never mind, says they will leave the message later, or only says thanks/ok, do not call send_admin_message." +
      "\n\nNever claim a message was sent to the admin unless send_admin_message returned ok: true. If the tool fails, apologize and say the admin could not be reached right now." +
      "\n\nIf get_information returns no results, answer honestly that you don't have that information, or ask if they'd like you to leave a message for the admin.",
    temperature: 0.3,
    maxOutputTokens: 500,
    stopWhen: stepCountIs(3),
    tools,
    messages: [...history.slice(-10), { role: "user", content: question }],
  });

  const trimmed = result.text.trim();
  logger.info(
    { hasResult: trimmed.length > 0, toolCalls: result.toolCalls?.length ?? 0, finishReason: result.finishReason },
    "AI response",
  );
  return { text: trimmed };
}
