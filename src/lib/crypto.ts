import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const MURDER_DIR = join(homedir(), ".murder");
const KEY_PATH = join(MURDER_DIR, "secret.key");

function ensureMasterKey(): Buffer {
  if (existsSync(KEY_PATH)) {
    return readFileSync(KEY_PATH);
  }

  if (!existsSync(MURDER_DIR)) {
    mkdirSync(MURDER_DIR, { recursive: true, mode: 0o700 });
  }

  const key = randomBytes(KEY_LENGTH);
  writeFileSync(KEY_PATH, key, { mode: 0o600 });
  return key;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a hex-encoded string in the format `iv:authTag:ciphertext`.
 */
export function encrypt(plaintext: string): string {
  const key = ensureMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with `encrypt()`.
 * Expects the hex-encoded `iv:authTag:ciphertext` format.
 */
export function decrypt(encoded: string): string {
  const key = ensureMasterKey();
  const [ivHex, authTagHex, ciphertext] = encoded.split(":");

  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error("Invalid encrypted value format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
