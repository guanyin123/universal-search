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

describe('serializeFrontmatter — YAML safety', () => {
  it('quotes a title containing a newline so the frontmatter block is not broken', () => {
    const fm = buildFrontmatter({ title: 'line1\nline2', date: '2026-06-17', tags: [], sources: [], related: [] });
    const out = serializeFrontmatter(fm);
    expect(out).toContain('title: "line1\\nline2"');
    // exactly two fences (open + close); the title's newline must not leak a stray line
    expect(out.split('\n').filter((l) => l === '---')).toHaveLength(2);
  });

  it('quotes YAML-reserved and flow-special scalars inside arrays', () => {
    const fm = buildFrontmatter({
      title: 'T',
      date: '2026-06-17',
      tags: ['null', 'a,b', '|pipe'],
      sources: [],
      related: []
    });
    const out = serializeFrontmatter(fm);
    expect(out).toContain('"null"');
    expect(out).toContain('"a,b"');
    expect(out).toContain('"|pipe"');
  });
});
