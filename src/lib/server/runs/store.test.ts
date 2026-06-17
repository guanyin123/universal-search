import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunStore } from './store';
import type { Run } from './types';

function sampleRun(id: string): Run {
  return {
    id, createdAt: '2026-06-17T00:00:00.000Z', status: 'proposing',
    question: 'q', models: { fanout: 'a', synth: 'b' },
    plan: { dimensions: [] }, evidence: []
  };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'runs-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('makeRunStore', () => {
  it('saves and reloads a run', async () => {
    const store = makeRunStore(dir);
    await store.save(sampleRun('run-1'));
    const got = await store.get('run-1');
    expect(got?.question).toBe('q');
  });

  it('writes atomically (no .tmp file left behind)', async () => {
    const store = makeRunStore(dir);
    await store.save(sampleRun('run-2'));
    const files = await readdir(dir);
    expect(files).toContain('run-2.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('queryRuns returns newest-first summaries', async () => {
    const store = makeRunStore(dir);
    await store.save({ ...sampleRun('run-a'), createdAt: '2026-06-01T00:00:00.000Z' });
    await store.save({ ...sampleRun('run-b'), createdAt: '2026-06-10T00:00:00.000Z' });
    const list = await store.query();
    expect(list.map((r) => r.id)).toEqual(['run-b', 'run-a']);
  });

  it('get returns null for missing id', async () => {
    const store = makeRunStore(dir);
    expect(await store.get('nope')).toBeNull();
  });

  it('get rethrows on corrupt JSON (distinct from missing)', async () => {
    const store = makeRunStore(dir);
    await writeFile(join(dir, 'bad.json'), '{ not valid }', 'utf8');
    await expect(store.get('bad')).rejects.toThrow();
  });
});
