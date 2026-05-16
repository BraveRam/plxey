import type { Api, Context } from "grammy";
import { logger } from "./logger";

type ReplyOptions = Parameters<Context["reply"]>[1];

async function deleteSafe(
  api: Api,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch (err) {
    // Best-effort. A message may already be gone, be older than 48h
    // (Telegram's hard delete window for bots), or otherwise be undeletable.
    // Never block the follow-up send on a failed delete.
    logger.debug({ err, chatId, messageId }, "deleteMessage failed (ignored)");
  }
}

/**
 * Delete the message tied to the current update (typically the message a
 * button was attached to) and send a new one in its place. Used in
 * non-conversation callback handlers as a drop-in for `ctx.editMessageText`.
 *
 * Why not just edit? Telegram does not reorder messages on edit — an edited
 * message stays in its original position. If the bot has sent any other
 * messages in between, the edited "current screen" ends up above newer
 * messages instead of at the bottom of the chat, which is what users expect
 * after pressing a button.
 */
export async function replaceMessage(
  ctx: Context,
  text: string,
  options?: ReplyOptions,
): Promise<void> {
  const target = ctx.callbackQuery?.message;
  if (target) {
    await deleteSafe(ctx.api, target.chat.id, target.message_id);
  }
  await ctx.reply(text, options);
}

export interface Screen {
  show(text: string, options?: ReplyOptions): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Track a single "screen" message inside a conversation. Each `show()`
 * deletes the previously-shown screen and sends a new one, so the screen
 * always renders at the bottom of the chat — even when the bot has sent
 * intermediate progress messages between updates.
 *
 * Seeds the initial screen id from the entering update's callbackQuery
 * message, so the very first `show()` replaces the button/menu that
 * triggered the conversation rather than orphaning it.
 *
 * Replay-safe: ctx.api calls are memoized by the conversations plugin, so
 * on conversation replay the delete/send pair returns its cached result
 * and the closure's screenMessageId converges to the same value
 * deterministically.
 */
export function createScreen(ctx: Context): Screen {
  const chatId = ctx.chat?.id;
  let screenMessageId: number | null =
    ctx.callbackQuery?.message?.message_id ?? null;

  return {
    async show(text, options) {
      if (chatId === undefined) return;
      if (screenMessageId !== null) {
        await deleteSafe(ctx.api, chatId, screenMessageId);
      }
      const sent = await ctx.api.sendMessage(chatId, text, options);
      screenMessageId = sent.message_id;
    },
    async clear() {
      if (chatId === undefined || screenMessageId === null) return;
      await deleteSafe(ctx.api, chatId, screenMessageId);
      screenMessageId = null;
    },
  };
}
