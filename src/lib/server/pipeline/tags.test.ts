import { describe, it, expect } from 'vitest';
import { buildTagsPrompt, parseTags } from './tags';

describe('tags', () => {
  it('prompt asks for 3-7 tags and includes the question', () => {
    const p = buildTagsPrompt('什么是 RAG', ['AI', 'LLM']);
    expect(p).toContain('什么是 RAG');
    expect(p).toContain('AI');
  });
  it('parseTags reads a JSON array and clamps to 3-7', () => {
    expect(parseTags('["a","b","c","d"]')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseTags('["a","b","c","d","e","f","g","h","i"]').length).toBe(7);
  });
  it('parseTags returns [] when unparseable (frontmatter tags stay empty)', () => {
    expect(parseTags('nope')).toEqual([]);
  });
});
