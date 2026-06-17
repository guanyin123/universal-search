import { describe, it, expect } from 'vitest';
import { buildProposePrompt, parseProposedQueries } from './propose';

describe('buildProposePrompt', () => {
  it('embeds the question and asks for a JSON array of web queries', () => {
    const p = buildProposePrompt('How does RAG work?');
    expect(p).toContain('How does RAG work?');
    expect(p.toLowerCase()).toContain('json');
  });
});

describe('parseProposedQueries', () => {
  it('extracts queries from a clean JSON array', () => {
    expect(parseProposedQueries('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });
  it('extracts a JSON array embedded in prose / code fences', () => {
    const raw = 'Sure!\n```json\n["x", "y"]\n```';
    expect(parseProposedQueries(raw)).toEqual(['x', 'y']);
  });
  it('caps at 3 and drops empties', () => {
    expect(parseProposedQueries('["a","","b","c","d"]')).toEqual(['a', 'b', 'c']);
  });
  it('throws when no array can be found', () => {
    expect(() => parseProposedQueries('no json here')).toThrow(/parse/i);
  });
  it('throws when the array yields no usable queries', () => {
    expect(() => parseProposedQueries('[]')).toThrow(/no usable queries/i);
    expect(() => parseProposedQueries('["", "  "]')).toThrow(/no usable queries/i);
  });
});
