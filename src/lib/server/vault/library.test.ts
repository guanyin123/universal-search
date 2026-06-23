import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatterFields, rankRelated, readVaultLibrary, type VaultNote } from './library';

describe('parseFrontmatterFields', () => {
  it('reads title and inline tags', () => {
    const md = '---\ntitle: Hello\ntype: synthesis\ntags: [AI, RAG, 检索]\n---\n# body';
    expect(parseFrontmatterFields(md)).toEqual({ title: 'Hello', tags: ['AI', 'RAG', '检索'] });
  });

  it('reads block-list tags', () => {
    const md = '---\ntitle: T\ntags:\n  - a\n  - b\nstatus: draft\n---\nbody';
    expect(parseFrontmatterFields(md)).toEqual({ title: 'T', tags: ['a', 'b'] });
  });

  it('returns null when there is no frontmatter', () => {
    expect(parseFrontmatterFields('# just a heading')).toBeNull();
  });
});

describe('rankRelated', () => {
  const notes: VaultNote[] = [
    { path: 'wiki/synthesis/a.md', title: 'A', tags: ['rag', 'ai', '检索'] },
    { path: 'wiki/synthesis/b.md', title: 'B', tags: ['ai'] },
    { path: 'wiki/synthesis/c.md', title: 'C', tags: ['cooking'] },
    { path: 'wiki/synthesis/self.md', title: 'Self', tags: ['rag', 'ai'] }
  ];

  it('ranks by shared-tag count, drops zero-overlap, excludes self, respects limit', () => {
    const out = rankRelated(notes, ['RAG', 'AI'], 'wiki/synthesis/self.md', 5);
    expect(out).toEqual(['wiki/synthesis/a.md', 'wiki/synthesis/b.md']); // a:2 > b:1, c:0 dropped, self excluded
  });

  it('returns [] when there are no target tags', () => {
    expect(rankRelated(notes, [], 'x', 5)).toEqual([]);
  });
});

describe('readVaultLibrary', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vault-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('scans wiki/synthesis frontmatter into a freq-ranked vocab + note index', async () => {
    const synth = join(dir, 'wiki/synthesis');
    await mkdir(join(synth, 'sub'), { recursive: true });
    await writeFile(join(synth, 'one.md'), '---\ntitle: One\ntags: [ai, rag]\n---\nx');
    await writeFile(join(synth, 'sub', 'two.md'), '---\ntitle: Two\ntags: [ai, 检索]\n---\ny');
    await writeFile(join(synth, 'no-fm.md'), 'no frontmatter here'); // skipped

    const lib = await readVaultLibrary(dir);
    expect(lib.notes.map((n) => n.path).sort()).toEqual([
      'wiki/synthesis/one.md',
      'wiki/synthesis/sub/two.md'
    ]);
    expect(lib.vocab[0]).toBe('ai'); // most frequent first
    expect(lib.vocab).toContain('rag');
    expect(lib.vocab).toContain('检索');
  });

  it('returns an empty library when the synthesis dir does not exist (fresh vault)', async () => {
    const lib = await readVaultLibrary(join(dir, 'nope'));
    expect(lib).toEqual({ vocab: [], notes: [] });
  });
});
