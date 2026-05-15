import { expect, test, describe, beforeEach } from "bun:test";
import { encrypt, decrypt } from "../src/lib/crypto";

describe("encrypt/decrypt", () => {
  test("roundtrip: decrypt reverses encrypt", async () => {
    const plaintext = "hello world";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("produces different ciphertext for same plaintext (random IV)", async () => {
    const plaintext = "hello world";
    const c1 = await encrypt(plaintext);
    const c2 = await encrypt(plaintext);
    expect(c1).not.toBe(c2);
  });

  test("roundtrip with special characters", async () => {
    const plaintext = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/~`\n\t ";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("roundtrip with Telegram-style bot token", async () => {
    const token = "1234567890:AAHhaikuToNjgELbDummyTokenFakeNvqW9g";
    const encrypted = await encrypt(token);
    const decrypted = await decrypt(encrypted);

    expect(decrypted).toBe(token);
    expect(encrypted).not.toBe(token);
    expect(encrypted.length).toBeGreaterThan(0);
  });

  test("roundtrip with empty string", async () => {
    const encrypted = await encrypt("");
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  test("tampered ciphertext throws", async () => {
    const encrypted = await encrypt("hello");
    const tampered = Buffer.from(encrypted, "base64").toJSON().data as number[];
    tampered[tampered.length - 5] ^= 0xff; // flip bits

    const bad = Buffer.from(tampered).toString("base64");
    await expect(decrypt(bad)).rejects.toThrow();
  });
});
