import { extractDocx } from "./docx";
import { extractHtml } from "./html";
import { extractPdf } from "./pdf";
import { extractPlain } from "./text";

export async function extractText(data: Uint8Array, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return extractPdf(data);
    case "text/plain":
    case "text/markdown":
      return extractPlain(data);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocx(data);
    case "text/html":
      return extractHtml(data);
    default:
      throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
}
