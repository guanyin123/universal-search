import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { assertCleanVault, autocommit } from './git';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vault-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 't@t.co');
  await git.addConfig('user.name', 'T');
  await writeFile(join(dir, 'seed.md'), 'seed');
  await git.add('.');
  await git.commit('init');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('assertCleanVault', () => {
  it('passes when the tree is clean', async () => {
    await expect(assertCleanVault(dir)).resolves.toBeUndefined();
  });
  it('throws when the tree is dirty (untracked file)', async () => {
    await writeFile(join(dir, 'dirty.md'), 'x');
    await expect(assertCleanVault(dir)).rejects.toThrow(/dirty/i);
  });
  it('throws when a tracked file is modified', async () => {
    await writeFile(join(dir, 'seed.md'), 'modified');
    await expect(assertCleanVault(dir)).rejects.toThrow(/dirty/i);
  });
  it('throws when a file is staged but not committed', async () => {
    await writeFile(join(dir, 'staged.md'), 'x');
    await simpleGit(dir).add('staged.md');
    await expect(assertCleanVault(dir)).rejects.toThrow(/dirty/i);
  });
});

describe('autocommit guard', () => {
  it('throws on an empty files list (never makes an empty/over-broad commit)', async () => {
    await expect(autocommit(dir, [], 'noop')).rejects.toThrow(/no files/i);
  });
});

describe('autocommit', () => {
  it('stages the given files and commits, returning a short sha', async () => {
    await mkdir(join(dir, 'wiki', 'synthesis'), { recursive: true });
    await writeFile(join(dir, 'wiki/synthesis/x.md'), 'report');
    const sha = await autocommit(dir, ['wiki/synthesis/x.md'], 'ingest: x');
    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    const log = await simpleGit(dir).log();
    expect(log.latest?.message).toContain('ingest: x');
  });
});
