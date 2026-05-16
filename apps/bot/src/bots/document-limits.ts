const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

export const MAX_DOCUMENT_SIZE_BYTES = 5 * BYTES_PER_MB;
export const MAX_DOCUMENTS_PER_BOT = 3;

export function formatBytes(n: number): string {
  if (n < BYTES_PER_KB) return `${n} bytes`;
  if (n < BYTES_PER_MB) return `${(n / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(n / BYTES_PER_MB).toFixed(1)} MB`;
}

export type DocumentAcceptCheck =
  | { ok: true }
  | { ok: false; reason: "too_large"; size: number; limit: number }
  | { ok: false; reason: "too_many"; count: number; limit: number };

export function checkDocumentLimits(args: {
  fileSize: number | undefined;
  currentDocCount: number;
}): DocumentAcceptCheck {
  // Count check first: if the owner is at the cap, the file size is moot —
  // they need to delete something regardless of how big the new upload is.
  if (args.currentDocCount >= MAX_DOCUMENTS_PER_BOT) {
    return {
      ok: false,
      reason: "too_many",
      count: args.currentDocCount,
      limit: MAX_DOCUMENTS_PER_BOT,
    };
  }

  const size = args.fileSize ?? 0;
  if (!size || size > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      size,
      limit: MAX_DOCUMENT_SIZE_BYTES,
    };
  }

  return { ok: true };
}
