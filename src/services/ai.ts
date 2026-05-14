import { generateText } from "ai";

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
): Promise<string | null> {
  const { text } = await generateText({
    model: process.env.AI_MODEL || "deepseek/deepseek-v4-flash",
    system:
      systemPrompt.replace("{business_name}", businessName) +
      "\n\n" + DEMO_KNOWLEDGE +
      "\n\nIf you cannot answer the question confidently, respond with exactly: UNSURE" +
      "\n\nIMPORTANT: The conversation history is provided below. Pay attention to it — if the user previously told you their name or other details, remember them. The 'provided documentation' refers to DEMO KNOWLEDGE above, but the conversation itself is also a source of information about the user.",
    temperature: 0.3,
    maxTokens: 500,
    messages: [
      ...history.slice(-10),
      { role: "user", content: question },
    ],
  });

  const trimmed = text.trim();
  if (trimmed === "UNSURE") return null;
  return trimmed;
}
