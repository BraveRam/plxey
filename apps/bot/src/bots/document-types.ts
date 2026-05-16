export const SUPPORTED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
]);

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
  htm: "text/html",
};

export function isSupportedDocumentType(mime: string): boolean {
  return SUPPORTED_DOCUMENT_TYPES.has(mime);
}

export function detectMimeType(
  fileName: string | undefined,
  mimeType: string | undefined,
): string | null {
  if (mimeType && isSupportedDocumentType(mimeType)) return mimeType;

  if (!fileName) return null;
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext || ext === fileName.toLowerCase()) return null;
  return EXTENSION_MIME_MAP[ext] ?? null;
}
