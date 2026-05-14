import { createHash } from "crypto";

const ALGORITHM = "AES-GCM";

function deriveKey(): Uint8Array {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    return new TextEncoder().encode(raw).slice(0, 32);
  }
  const hash = createHash("sha256").update(process.env.BOT_TOKEN || "dev-key-fallback").digest();
  return new Uint8Array(hash);
}

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = deriveKey();
  cachedKey = await crypto.subtle.importKey("raw", raw, ALGORITHM, false, ["encrypt", "decrypt"]);
  return cachedKey;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(combined).toString("base64");
}

export async function decrypt(ciphertext: string): Promise<string> {
  const key = await getKey();
  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, data);
  return new TextDecoder().decode(decrypted);
}
