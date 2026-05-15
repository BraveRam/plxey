import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const DEMO_KNOWLEDGE = `
DEMO KNOWLEDGE:
- Refund policy: Full refund within 30 days of purchase
- Business hours: Monday-Friday 9AM-5PM EST
- How to reset password: Go to Settings > Account > Reset Password
- Supported payment methods: Credit card, PayPal, Apple Pay
- Shipping: Free shipping on orders over $50, takes 3-5 business days
- Contact info: Email support@acme.com or call 1-800-555-ACME

IMPORTANT: Pay close attention to the conversation history. If a user tells you their name, remember it and use it naturally in your responses.
`;

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface SendAdminMessageResult {
  ok: boolean;
  error?: string;
}

interface AskAIOptions {
  sendAdminMessage?: (input: { message: string; reason: string }) => Promise<SendAdminMessageResult>;
}

export async function askAI(
  question: string,
  businessName: string,
  systemPrompt: string,
  history: HistoryEntry[] = [],
  options: AskAIOptions = {},
): Promise<{ text: string | null }> {
  const tools = options.sendAdminMessage
    ? {
        send_admin_message: tool({
          description:
            "Send a concrete customer message to the human admin. Only call this when you have the exact message text to pass along.",
          inputSchema: z.object({
            message: z.string().describe("The exact customer message to send to the admin"),
            reason: z.string().describe("Why this needs the human admin"),
          }),
          execute: async ({ message, reason }) => {
            return options.sendAdminMessage!({ message, reason });
          },
        }),
      }
    : undefined;

  const result = await generateText({
    model: process.env.AI_MODEL || "deepseek/deepseek-v4-flash",
    system:
      systemPrompt.replace("{business_name}", businessName) +
      "\n\n" +
      DEMO_KNOWLEDGE +
      "\n\nUse the conversation history for context." +
      "\n\nIf the customer asks to leave a message for the admin but does not provide the actual message, ask what they would like you to tell the admin. Do not call a tool yet." +
      "\n\nIf the customer gives the actual message to pass to the admin, call send_admin_message with the exact message." +
      "\n\nIf the customer cancels, says never mind, says they will leave the message later, or only says thanks/ok, do not call send_admin_message." +
      "\n\nNever claim a message was sent to the admin unless send_admin_message returned ok: true. If the tool fails, apologize and say the admin could not be reached right now.",
    temperature: 0.3,
    maxOutputTokens: 500,
    stopWhen: stepCountIs(3),
    tools,
    messages: [...history.slice(-10), { role: "user", content: question }],
  });

  const trimmed = result.text.trim();
  return { text: trimmed };
}
