/**
 * Parsing + fetching helpers for inbound customer business messages that may
 * carry an image. Kept out of the giant `registry.ts` handler so the parsing
 * logic stays pure and unit-testable, and the Telegram download reuses one
 * place.
 */

import type { Context } from "grammy";
import { logger } from "./logger";

/**
 * Hard cap on a downloaded customer photo. Telegram compresses `photo`
 * uploads well below this; anything larger is treated as a failed download
 * and the turn falls back to text-only.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Structural shape of the fields we read off a Telegram business message. */
export interface IncomingBusinessMessage {
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string }>;
}

/**
 * Extract the usable text and the largest photo's file_id from an inbound
 * business message. `text` falls back to the caption; both are trimmed.
 * `photoFileId` is the last (largest) `photo` size, or null when there's no
 * photo. Returns `{ text: "", photoFileId: null }` for unsupported media
 * (sticker/voice/etc.) so the caller can drop the update.
 */
export function parseIncomingMessage(msg: IncomingBusinessMessage): {
  text: string;
  photoFileId: string | null;
} {
  const text = (msg.text ?? msg.caption ?? "").trim();
  const photoFileId =
    msg.photo && msg.photo.length > 0
      ? msg.photo[msg.photo.length - 1]!.file_id
      : null;
  return { text, photoFileId };
}

/**
 * Download a Telegram photo by `file_id` to raw bytes for inline model input.
 * Reuses the document-upload download pattern (getFile → CDN URL → fetch).
 * Returns null on any failure or oversize so the caller falls back to a
 * text-only turn. `token` is the bot's decrypted token — never log it.
 */
export async function downloadTelegramPhoto(
  api: Context["api"],
  token: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  const file = await api.getFile(fileId);
  const filePath = file.file_path;
  if (!filePath) {
    logger.warn({ fileId }, "telegram getFile returned no file_path");
    return null;
  }

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) {
    logger.warn({ status: res.status }, "telegram file download not OK");
    return null;
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    logger.warn({ declared }, "telegram photo exceeds MAX_IMAGE_BYTES");
    return null;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    logger.warn({ size: bytes.byteLength }, "telegram photo exceeds MAX_IMAGE_BYTES");
    return null;
  }

  // Telegram `photo` uploads are always JPEG.
  return { bytes, mediaType: "image/jpeg" };
}
