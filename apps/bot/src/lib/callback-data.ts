/**
 * Telegram caps inline-keyboard `callback_data` at 64 bytes UTF-8. When a
 * button's data exceeds the cap, the entire `sendMessage` call silently
 * fails — no error is surfaced and the user sees nothing.
 *
 * We've hit this twice in the billing flow (cancel-confirm with the
 * ~140-char telegram_payment_charge_id, and cancel-reason with the
 * verbose `billing_cancel_reason_` prefix + 36-char UUID). Both bugs were
 * only visible in live testing.
 *
 * `cbd(data)` is a passthrough wrapper that asserts the byte budget at
 * button-construction time. Use it on every callback string built from
 * runtime values (charge ids, UUIDs, user ids). Static literals don't
 * need it.
 *
 * Failure is loud: throws so the bug surfaces in logs immediately instead
 * of as a silent Telegram-side rejection.
 */

const MAX_CALLBACK_DATA_BYTES = 64;
const ENCODER = new TextEncoder();

export function cbd(data: string): string {
  const bytes = ENCODER.encode(data).length;
  if (bytes > MAX_CALLBACK_DATA_BYTES) {
    throw new Error(
      `callback_data exceeds Telegram's ${MAX_CALLBACK_DATA_BYTES}-byte cap ` +
        `(${bytes} bytes): "${data.slice(0, 80)}${data.length > 80 ? "…" : ""}"`,
    );
  }
  return data;
}

export const CALLBACK_DATA_MAX_BYTES = MAX_CALLBACK_DATA_BYTES;
