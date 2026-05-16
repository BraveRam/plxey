import { InlineKeyboard } from "grammy";

export const DEFAULT_WELCOME_MESSAGE =
  "This is the customer support bot for this business. Click below to send them a message:";

interface RenderWelcomeArgs {
  welcomeMessage: string | null | undefined;
  connectedBusinessUserId: string | null;
}

interface RenderedWelcome {
  text: string;
  keyboard: InlineKeyboard | null;
}

export function renderCustomerWelcome({
  welcomeMessage,
  connectedBusinessUserId,
}: RenderWelcomeArgs): RenderedWelcome {
  const trimmed = welcomeMessage?.trim();
  const text = trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WELCOME_MESSAGE;

  const keyboard = connectedBusinessUserId
    ? new InlineKeyboard().url(
        "💬 Contact Business",
        `tg://user?id=${connectedBusinessUserId}`,
      )
    : null;

  return { text, keyboard };
}
