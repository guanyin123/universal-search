import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, resolveMasterKey } from './crypto';

describe('crypto: encrypt/decrypt', () => {
  it('round-trips a secret', () => {
    const key = randomBytes(32);
    const blob = encryptSecret('sk-super-secret-123', key);
    expect(blob).not.toContain('sk-super-secret-123'); // ciphertext, not plaintext
    expect(decryptSecret(blob, key)).toBe('sk-super-secret-123');
  });

  it('produces a different ciphertext each time (random IV) but decrypts identically', () => {
    const key = randomBytes(32);
    const a = encryptSecret('same', key);
    const b = encryptSecret('same', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('same');
    expect(decryptSecret(b, key)).toBe('same');
  });

  it('fails to decrypt with the wrong key (auth tag rejects)', () => {
    const blob = encryptSecret('secret', randomBytes(32));
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
  });
});

describe('crypto: resolveMasterKey', () => {
  it('derives a deterministic 32-byte key from SETTINGS_SECRET', () => {
    const dir = mkdtempSync(join(tmpdir(), 'us-key-'));
    const file = join(dir, 'settings.key');
    const a = resolveMasterKey(file, { SETTINGS_SECRET: 'pin-me' } as NodeJS.ProcessEnv);
    const b = resolveMasterKey(file, { SETTINGS_SECRET: 'pin-me' } as NodeJS.ProcessEnv);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  it('generates and persists a random key file, then reloads the same key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'us-key-'));
    const file = join(dir, 'settings.key');
    const first = resolveMasterKey(file, {} as NodeJS.ProcessEnv);
    expect(first.length).toBe(32);
    expect(readFileSync(file, 'utf8').trim()).toHaveLength(64); // 32 bytes hex
    const second = resolveMasterKey(file, {} as NodeJS.ProcessEnv);
    expect(second.equals(first)).toBe(true);
  });

  it('regenerates when the persisted key is malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'us-key-'));
    const file = join(dir, 'settings.key');
    writeFileSync(file, 'not-hex');
    const key = resolveMasterKey(file, {} as NodeJS.ProcessEnv);
    expect(key.length).toBe(32);
    expect(readFileSync(file, 'utf8').trim()).toHaveLength(64);
  });
});
