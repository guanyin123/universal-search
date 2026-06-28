import { describe, it, expect } from 'vitest';
import { buildRankPrompt, parseRankJudgments, rankRepos } from './github-rank';
import type { SourceResult } from '../search/types';

const cand = (over: Partial<SourceResult> = {}): SourceResult => ({
  url: 'https://github.com/o/r',
  title: 'o/r',
  snippet: 'desc',
  stars: 100,
  ...over
});

describe('buildRankPrompt', () => {
  it('lists each candidate with stars and asks for a strict JSON array', () => {
    const p = buildRankPrompt('a fast vector db', [
      cand({ title: 'a/one', stars: 5000, language: 'Rust', topics: ['db'] }),
      cand({ title: 'b/two', stars: 20 })
    ]);
    expect(p).toContain('a fast vector db');
    expect(p).toContain('a/one');
    expect(p).toContain('stars: 5000');
    expect(p).toContain('b/two');
    expect(p).toMatch(/JSON array/i);
    expect(p).toContain('reputation');
  });
});

describe('parseRankJudgments', () => {
  it('parses a JSON array into a case-insensitive name→judgment map', () => {
    const m = parseRankJudgments('[{"name":"A/One","reputation":9,"reason":"mature"},{"name":"b/two","reputation":4,"reason":"niche"}]');
    expect(m.get('a/one')).toEqual({ reputation: 9, reason: 'mature' });
    expect(m.get('b/two')).toEqual({ reputation: 4, reason: 'niche' });
  });

  it('clamps out-of-range reputations and defaults non-numeric to 5', () => {
    const m = parseRankJudgments('[{"name":"x/y","reputation":99},{"name":"p/q","reputation":"high"}]');
    expect(m.get('x/y')?.reputation).toBe(10);
    expect(m.get('p/q')?.reputation).toBe(5);
  });

  it('tolerates surrounding prose by extracting the array', () => {
    const m = parseRankJudgments('Here you go:\n[{"name":"a/b","reputation":7,"reason":"ok"}]\nthanks');
    expect(m.get('a/b')?.reputation).toBe(7);
  });

  it('throws when no array is present', () => {
    expect(() => parseRankJudgments('no json here')).toThrow();
  });
});

describe('rankRepos', () => {
  const candidates = [
    cand({ title: 'big/stars', url: 'https://github.com/big/stars', stars: 10000 }),
    cand({ title: 'small/stars', url: 'https://github.com/small/stars', stars: 100 }),
    cand({ title: 'mid/stars', url: 'https://github.com/mid/stars', stars: 2000 })
  ];

  it('blends stars + reputation; reputation can outrank raw stars', () => {
    const judgments = parseRankJudgments(
      '[{"name":"big/stars","reputation":1,"reason":"abandoned"},{"name":"mid/stars","reputation":10,"reason":"loved"},{"name":"small/stars","reputation":5}]'
    );
    const ranked = rankRepos(candidates, judgments);
    // mid (high reputation) should beat big (low reputation) despite fewer stars
    expect(ranked[0].fullName).toBe('mid/stars');
    expect(ranked.every((r) => typeof r.score === 'number')).toBe(true);
    expect(ranked.find((r) => r.fullName === 'big/stars')?.reason).toBe('abandoned');
  });

  it('defaults to neutral reputation (5) when judgments are empty → effectively stars-only', () => {
    const ranked = rankRepos(candidates, new Map());
    expect(ranked.map((r) => r.fullName)).toEqual(['big/stars', 'mid/stars', 'small/stars']);
    expect(ranked.every((r) => r.reputation === 5)).toBe(true);
  });

  it('caps the result at the limit (default 5)', () => {
    const many = Array.from({ length: 9 }, (_, i) => cand({ title: `o/r${i}`, url: `https://github.com/o/r${i}`, stars: i * 100 }));
    expect(rankRepos(many, new Map())).toHaveLength(5);
    expect(rankRepos(many, new Map(), 3)).toHaveLength(3);
  });

  it('maps repo metadata onto the ranked output', () => {
    const ranked = rankRepos(
      [cand({ title: 'o/r', stars: 42, language: 'Go', license: 'MIT', pushedAt: '2026-06-01T00:00:00Z', topics: ['cli'] })],
      new Map()
    );
    expect(ranked[0]).toMatchObject({
      fullName: 'o/r',
      stars: 42,
      language: 'Go',
      license: 'MIT',
      pushedAt: '2026-06-01T00:00:00Z',
      topics: ['cli']
    });
  });
});
