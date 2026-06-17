import { describe, it, expect } from 'vitest';
import { buildFrontmatter, serializeFrontmatter } from './frontmatter';

describe('buildFrontmatter', () => {
  it('produces the vault synthesis schema', () => {
    const fm = buildFrontmatter({
      title: '什么是 RAG',
      date: '2026-06-17',
      tags: ['AI', 'RAG'],
      sources: ['raw/research/2026-06-17-rag/1-a.md', 'https://a.com'],
      related: []
    });
    expect(fm.type).toBe('synthesis');
    expect(fm.status).toBe('draft');
    expect(fm.confidence).toBe('medium');
    expect(fm.created).toBe('2026-06-17');
    expect(fm.updated).toBe('2026-06-17');
  });
});

describe('serializeFrontmatter', () => {
  it('emits YAML between --- fences with array fields inline', () => {
    const fm = buildFrontmatter({ title: 'T', date: '2026-06-17', tags: ['a', 'b'], sources: ['s'], related: [] });
    const out = serializeFrontmatter(fm);
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('type: synthesis');
    expect(out).toContain('tags: [a, b]');
    expect(out).toContain('related: []');
    expect(out.trim().endsWith('---')).toBe(true);
  });
});
