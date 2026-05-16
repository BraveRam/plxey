import mammoth from "mammoth";

export async function extractDocx(data: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return result.value.replace(/\0/g, "");
}
