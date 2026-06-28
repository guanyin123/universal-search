import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveMasterKey, encryptSecret, decryptSecret } from './crypto';
import type { Channel, ChannelInput, ChannelPatch, ChannelPublic } from './types';

const ACTIVE_KEY = 'active_channel_id';

interface ChannelRow {
  id: string;
  name: string;
  base_url: string;
  api_key_enc: string;
  models_json: string | null;
  fanout_model: string | null;
  synth_model: string | null;
  created_at: string;
}

export interface SettingsStore {
  /** All channels, public shape (no plaintext keys). */
  list(): ChannelPublic[];
  /** One channel with decrypted key — SERVER-ONLY. */
  get(id: string): Channel | null;
  create(input: ChannelInput): ChannelPublic;
  /** Returns null when the id doesn't exist. */
  update(id: string, patch: ChannelPatch): ChannelPublic | null;
  remove(id: string): boolean;
  getActiveId(): string | null;
  setActive(id: string): boolean;
  /** The active channel with decrypted key — SERVER-ONLY. */
  getActiveChannel(): Channel | null;
  /** Seed a channel on first run. No-op once any channel exists, or when `seed` is null. */
  seedFromEnv(seed: ChannelInput | null): void;
  close(): void;
}

function newId(): string {
  return randomBytes(8).toString('hex');
}

function keyHint(key: string): string {
  const k = key.trim();
  return k.length <= 4 ? '••••' : `••••${k.slice(-4)}`;
}

/**
 * SQLite-backed settings store (via Node's built-in `node:sqlite`). Persists AI
 * provider "channels" with their API keys encrypted at rest. Mirrors the factory +
 * synchronous style of `runs/store.ts`; the data lives under `dir` (e.g. `.data/`).
 */
export function makeSettingsStore(dir: string, env: NodeJS.ProcessEnv = process.env): SettingsStore {
  mkdirSync(dir, { recursive: true });
  const key = resolveMasterKey(join(dir, 'settings.key'), env);
  const db = new DatabaseSync(join(dir, 'settings.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      models_json TEXT,
      fanout_model TEXT,
      synth_model TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  function rowToChannel(r: ChannelRow): Channel {
    return {
      id: r.id,
      name: r.name,
      baseURL: r.base_url,
      apiKey: decryptSecret(r.api_key_enc, key),
      models: r.models_json ? (JSON.parse(r.models_json) as string[]) : [],
      fanoutModel: r.fanout_model ?? undefined,
      synthModel: r.synth_model ?? undefined,
      createdAt: r.created_at
    };
  }

  function toPublic(c: Channel): ChannelPublic {
    return {
      id: c.id,
      name: c.name,
      baseURL: c.baseURL,
      models: c.models,
      fanoutModel: c.fanoutModel,
      synthModel: c.synthModel,
      hasKey: c.apiKey.trim().length > 0,
      keyHint: keyHint(c.apiKey),
      createdAt: c.createdAt
    };
  }

  function getRow(id: string): ChannelRow | undefined {
    return db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
  }

  function get(id: string): Channel | null {
    const r = getRow(id);
    return r ? rowToChannel(r) : null;
  }

  function getActiveId(): string | null {
    const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ACTIVE_KEY) as
      | { value: string }
      | undefined;
    return r?.value ?? null;
  }

  function setActive(id: string): boolean {
    if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id)) return false;
    db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(ACTIVE_KEY, id);
    return true;
  }

  function clearActive(): void {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(ACTIVE_KEY);
  }

  function create(input: ChannelInput): ChannelPublic {
    const id = newId();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO channels (id, name, base_url, api_key_enc, models_json, fanout_model, synth_model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.baseURL,
      encryptSecret(input.apiKey ?? '', key),
      input.models?.length ? JSON.stringify(input.models) : null,
      input.fanoutModel ?? null,
      input.synthModel ?? null,
      createdAt
    );
    // The first channel becomes active automatically.
    if (!getActiveId()) setActive(id);
    return toPublic(rowToChannel(getRow(id)!));
  }

  function update(id: string, patch: ChannelPatch): ChannelPublic | null {
    const existing = get(id);
    if (!existing) return null;
    const apiKey = patch.apiKey && patch.apiKey.trim() ? patch.apiKey : existing.apiKey;
    const models = patch.models ?? existing.models;
    const fanout = patch.fanoutModel !== undefined ? patch.fanoutModel : existing.fanoutModel;
    const synth = patch.synthModel !== undefined ? patch.synthModel : existing.synthModel;
    db.prepare(
      `UPDATE channels SET name = ?, base_url = ?, api_key_enc = ?, models_json = ?, fanout_model = ?, synth_model = ?
       WHERE id = ?`
    ).run(
      patch.name ?? existing.name,
      patch.baseURL ?? existing.baseURL,
      encryptSecret(apiKey, key),
      models.length ? JSON.stringify(models) : null,
      fanout ?? null,
      synth ?? null,
      id
    );
    return toPublic(rowToChannel(getRow(id)!));
  }

  function remove(id: string): boolean {
    const removed = db.prepare('DELETE FROM channels WHERE id = ?').run(id).changes > 0;
    if (removed && getActiveId() === id) {
      const next = db.prepare('SELECT id FROM channels ORDER BY created_at LIMIT 1').get() as
        | { id: string }
        | undefined;
      if (next) setActive(next.id);
      else clearActive();
    }
    return removed;
  }

  return {
    list() {
      const rows = db
        .prepare('SELECT * FROM channels ORDER BY created_at')
        .all() as unknown as ChannelRow[];
      return rows.map((r) => toPublic(rowToChannel(r)));
    },
    get,
    create,
    update,
    remove,
    getActiveId,
    setActive,
    getActiveChannel() {
      const id = getActiveId();
      return id ? get(id) : null;
    },
    seedFromEnv(seed) {
      if (!seed) return;
      const count = (db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }).n;
      if (count > 0) return;
      create(seed);
    },
    close() {
      db.close();
    }
  };
}
