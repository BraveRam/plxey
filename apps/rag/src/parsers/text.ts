export async function extractPlain(data: Uint8Array): Promise<string> {
  return new TextDecoder("utf-8").decode(data).replace(/\0/g, "");
}
