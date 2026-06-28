import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSettingsStore } from './store';

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), 'us-settings-'));
  return makeSettingsStore(dir, { SETTINGS_SECRET: 'test-secret' } as NodeJS.ProcessEnv);
}

const input = {
  name: 'OpenAI',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-abcd1234',
  models: ['gpt-4o', 'gpt-4o-mini'],
  fanoutModel: 'gpt-4o-mini',
  synthModel: 'gpt-4o'
};

describe('settings store: CRUD', () => {
  it('creates a channel, exposes a public shape with no plaintext key, and decrypts on get', () => {
    const s = freshStore();
    const pub = s.create(input);
    expect(pub.id).toBeTruthy();
    expect(pub.name).toBe('OpenAI');
    expect(pub.hasKey).toBe(true);
    expect(pub.keyHint).toBe('••••1234');
    expect(JSON.stringify(pub)).not.toContain('sk-abcd1234'); // never leaks the key

    const full = s.get(pub.id);
    expect(full?.apiKey).toBe('sk-abcd1234'); // server-side decryption works
    expect(full?.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('makes the first channel active automatically', () => {
    const s = freshStore();
    const a = s.create(input);
    expect(s.getActiveId()).toBe(a.id);
    const b = s.create({ ...input, name: 'Second' });
    expect(s.getActiveId()).toBe(a.id); // still the first
    expect(s.setActive(b.id)).toBe(true);
    expect(s.getActiveChannel()?.name).toBe('Second');
  });

  it('keeps the existing key when update omits apiKey, and replaces it when provided', () => {
    const s = freshStore();
    const a = s.create(input);
    s.update(a.id, { name: 'Renamed' });
    expect(s.get(a.id)?.apiKey).toBe('sk-abcd1234'); // unchanged
    expect(s.get(a.id)?.name).toBe('Renamed');
    s.update(a.id, { apiKey: 'sk-newkey9999' });
    expect(s.get(a.id)?.apiKey).toBe('sk-newkey9999');
    expect(s.list().find((c) => c.id === a.id)?.keyHint).toBe('••••9999');
  });

  it('returns null when updating a missing channel', () => {
    const s = freshStore();
    expect(s.update('nope', { name: 'x' })).toBeNull();
  });

  it('removes a channel and reassigns active to a remaining one', () => {
    const s = freshStore();
    const a = s.create(input);
    const b = s.create({ ...input, name: 'Second' });
    s.setActive(a.id);
    expect(s.remove(a.id)).toBe(true);
    expect(s.getActiveId()).toBe(b.id); // reassigned
    expect(s.remove(b.id)).toBe(true);
    expect(s.getActiveId()).toBeNull(); // cleared when none remain
  });

  it('setActive rejects an unknown id', () => {
    const s = freshStore();
    expect(s.setActive('ghost')).toBe(false);
  });
});

describe('settings store: seedFromEnv', () => {
  it('seeds once when empty and is a no-op afterwards', () => {
    const s = freshStore();
    s.seedFromEnv({ name: 'env', baseURL: 'https://x/v1', apiKey: 'sk-1', models: ['m'] });
    expect(s.list()).toHaveLength(1);
    expect(s.getActiveChannel()?.name).toBe('env');
    s.seedFromEnv({ name: 'again', baseURL: 'https://y/v1', apiKey: 'sk-2', models: ['m'] });
    expect(s.list()).toHaveLength(1); // unchanged
  });

  it('does nothing when seed is null', () => {
    const s = freshStore();
    s.seedFromEnv(null);
    expect(s.list()).toHaveLength(0);
  });
});

describe('settings store: persistence', () => {
  it('persists across store instances on the same dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'us-settings-'));
    const env = { SETTINGS_SECRET: 'persist-secret' } as NodeJS.ProcessEnv;
    const s1 = makeSettingsStore(dir, env);
    const created = s1.create(input);
    s1.close();
    const s2 = makeSettingsStore(dir, env);
    expect(s2.get(created.id)?.apiKey).toBe('sk-abcd1234'); // re-opened + decrypted
    expect(s2.getActiveId()).toBe(created.id);
  });
});
