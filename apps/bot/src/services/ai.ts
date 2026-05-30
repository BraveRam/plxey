import { generateText, stepCountIs, tool } from "ai";
import type { UserContent } from "ai";
import { z } from "zod";
import { logger } from "../lib/logger";
import { findRelevantContent } from "./retrieval";
import type { PlanKey } from "../lib/plans";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface SendAdminMessageResult {
  ok: boolean;
  error?: string;
}

/** An inline image to attach to the current user turn (business plan only). */
export interface InlineImage {
  bytes: Uint8Array;
  mediaType: string;
}

interface AskAIOptions {
  botId: string;
  /** Owner's effective plan — selects the model (business → vision Gemini). */
  plan?: PlanKey | null;
  /** Inline image for this turn; only set for business-plan bots. */
  image?: InlineImage;
  sendAdminMessage?: (input: {
    message: string;
    reason: string;
  }) => Promise<SendAdminMessageResult>;
}

const IMAGE_FALLBACK_PROMPT =
  "Please answer the customer's question about the attached image.";

/**
 * Pick the model for a turn. Business-tier owners get the vision-capable
 * Gemini model (overridable via `AI_MODEL_BUSINESS`); every other plan keeps
 * the existing default (`AI_MODEL`). This is the only per-plan model routing
 * in the app.
 */
export function selectModel(plan: PlanKey | null): string {
  if (plan === "business") {
    return process.env.AI_MODEL_BUSINESS || "google/gemini-2.5-flash-lite";
  }
  return process.env.AI_MODEL || "deepseek/deepseek-v4-flash";
}

/**
 * Build the current user message content. Text-only turns stay a plain
 * string; an image turn becomes [text, image] parts with the raw bytes
 * inlined (the AI SDK accepts a Uint8Array directly — no URL needed). An
 * image with an empty caption gets a fallback instruction so the model has
 * something to act on.
 */
export function buildUserContent(
  question: string,
  image?: InlineImage,
): UserContent {
  if (!image) return question;
  return [
    { type: "text", text: question.trim() || IMAGE_FALLBACK_PROMPT },
    { type: "image", image: image.bytes, mediaType: image.mediaType },
  ];
}

export async function askAI(
  question: string,
  systemPrompt: string,
  history: HistoryEntry[] = [],
  options: AskAIOptions,
): Promise<{ text: string | null }> {
  const tools = {
    ...(options.sendAdminMessage
      ? {
          send_admin_message: tool({
            description:
              "Send a concrete customer message to the human admin. Only call this when you have the exact message text to pass along.",
            inputSchema: z.object({
              message: z
                .string()
                .describe("The exact customer message to send to the admin"),
              reason: z.string().describe("Why this needs the human admin"),
            }),
            execute: async ({
              message,
              reason,
            }: {
              message: string;
              reason: string;
            }) => {
              logger.info({ reason }, "send_admin_message tool called");
              return options.sendAdminMessage!({ message, reason });
            },
          }),
        }
      : {}),
    get_information: tool({
      description:
        "Search the knowledge base for information relevant to the customer's question. Call this to retrieve context from uploaded documents.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The search query based on the customer's question"),
      }),
      execute: async ({ query }: { query: string }) => {
        const results = await findRelevantContent(query, options.botId);
        if (results.length === 0) {
          return {
            found: false,
            message: "No relevant information found in the knowledge base.",
          };
        }
        return {
          found: true,
          chunks: results.map((r) => r.content).join("\n\n---\n\n"),
        };
      },
    }),
  };

  const result = await generateText({
    model: selectModel(options.plan ?? null),
    system:
      systemPrompt +
      "\n\nUse the conversation history for context." +
      "\n\nFacts stated in your instructions above — including the business or company name, what the business does, and your role — are authoritative. When a customer asks about them, answer directly and confidently from your instructions; do NOT call get_information for these, and do NOT say the documentation lacks the answer. For example, if your instructions describe you as the assistant for a named company, treat that as the company's name and state it when asked." +
      "\n\nYou have a knowledge base of uploaded documents. For other questions that need specific information (products, policies, prices, hours, etc.), call get_information first. Do not invent facts that are neither in your instructions nor returned by get_information." +
      "\n\nIf the customer asks to leave a message for the admin but does not provide the actual message, ask what they would like you to tell the admin. Do not call a tool yet." +
      "\n\nIf the customer gives the actual message to pass to the admin, call send_admin_message with the exact message." +
      "\n\nIf the customer cancels, says never mind, says they will leave the message later, or only says thanks/ok, do not call send_admin_message." +
      "\n\nNever claim a message was sent to the admin unless send_admin_message returned ok: true. If the tool fails, apologize and say the admin could not be reached right now." +
      "\n\nIf a question needs document context and get_information returns no results — and the answer isn't already stated in your instructions — say honestly that you don't have that information, or ask if they'd like you to leave a message for the admin.",
    temperature: 0.3,
    maxOutputTokens: 500,
    stopWhen: stepCountIs(3),
    tools,
    messages: [
      ...history.slice(-10),
      { role: "user", content: buildUserContent(question, options.image) },
    ],
  });

  const trimmed = result.text.trim();
  logger.info(
    {
      hasResult: trimmed.length > 0,
      toolCalls: result.toolCalls?.length ?? 0,
      finishReason: result.finishReason,
    },
    "AI response",
  );
  return { text: trimmed };
}
