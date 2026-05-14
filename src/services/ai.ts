import { generateText, tool } from "ai";
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

export async function askAI(
  question: string,
  businessName: string,
  systemPrompt: string,
  history: HistoryEntry[] = [],
): Promise<{ text: string | null; transfer?: { reason: string } }> {
  const result = await generateText({
    model: process.env.AI_MODEL || "deepseek/deepseek-v4-flash",
    system:
      systemPrompt.replace("{business_name}", businessName) +
      "\n\n" + DEMO_KNOWLEDGE +
      "\n\nThe conversation history is below. Use it for context. If you cannot answer, respond with UNSURE." +
      "\n\nIf the customer asks to speak to a human, or if you genuinely cannot help, use the transfer_to_admin tool.",
    temperature: 0.3,
    maxTokens: 500,
    tools: {
      transfer_to_admin: tool({
        description: "Transfer the customer to a human admin when you cannot answer or they ask for one",
        parameters: z.object({
          reason: z.string().describe("Why this needs a human admin"),
        }),
      }),
    },
    messages: [
      ...history.slice(-10),
      { role: "user", content: question },
    ],
  });

  if (result.toolCalls?.length) {
    const tc = result.toolCalls[0];
    const raw = JSON.stringify(tc);
    let reason = "Customer requested transfer";
    try {
      const parsed = typeof tc.args === "string" ? JSON.parse(tc.args) : tc.args ?? {};
      reason = parsed.reason ?? reason;
    } catch {}
    return { text: null, transfer: { reason } };
  }

  const trimmed = result.text.trim();
  if (trimmed === "UNSURE") return { text: null };
  return { text: trimmed };
}
