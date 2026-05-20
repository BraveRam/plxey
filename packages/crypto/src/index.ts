import { createHash } from "crypto";

const ALGORITHM = "AES-GCM";

function deriveKey(): Uint8Array<ArrayBuffer> {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    return new TextEncoder().encode(raw).slice(0, 32) as Uint8Array<ArrayBuffer>;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY environment variable is required in production");
  }
  console.warn("ENCRYPTION_KEY not set — using dev fallback key (insecure)");
  const hash = createHash("sha256").update("dev-key-fallback").digest();
  return new Uint8Array(hash) as Uint8Array<ArrayBuffer>;
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
