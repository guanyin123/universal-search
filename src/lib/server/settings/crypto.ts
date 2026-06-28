import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Resolve the 32-byte master key used to encrypt channel API keys at rest.
 * Precedence:
 *   1. `SETTINGS_SECRET` env → scrypt-derived 32 bytes (pin a key across machines/containers).
 *   2. A random key persisted at `keyFile` (generated on first run, 0600).
 *
 * This is an at-rest *encryption* secret — NOT the AI-model config — so it does not
 * reintroduce the ".env configures the model" coupling we're removing.
 */
export function resolveMasterKey(keyFile: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.SETTINGS_SECRET?.trim();
  if (secret) return scryptSync(secret, 'universal-search:settings', 32);

  if (existsSync(keyFile)) {
    const buf = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
    if (buf.length === 32) return buf;
  }
  const key = randomBytes(32);
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  try {
    chmodSync(keyFile, 0o600);
  } catch {
    /* best-effort on platforms without POSIX perms */
  }
  return key;
}

/** Encrypt plaintext → base64(iv(12) | tag(16) | ciphertext). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt base64(iv|tag|ct) → plaintext. Throws on tamper / wrong key. */
export function decryptSecret(blob: string, key: Buffer): string {
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
