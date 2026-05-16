import { PDFParse } from "pdf-parse";

export async function extractPdf(data: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: Buffer.from(data) as never });
  const result = await parser.getText();
  return result.text.replace(/\0/g, "");
}
