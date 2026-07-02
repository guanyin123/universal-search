import { describe, it, expect } from 'vitest';
import { normalizeDomain, parseTrancoCsv, trancoScoreFromRank, scoreDomain } from './tranco';

describe('normalizeDomain', () => {
  it('strips scheme, www, path and port; lowercases', () => {
    expect(normalizeDomain('https://www.StackOverflow.com/questions/1')).toBe('stackoverflow.com');
    expect(normalizeDomain('reddit.com')).toBe('reddit.com');
    expect(normalizeDomain('http://example.com:8080/x')).toBe('example.com');
  });
});

describe('parseTrancoCsv', () => {
  it('parses `rank,domain` lines into a domain→rank map', () => {
    const map = parseTrancoCsv('1,google.com\n2,youtube.com\n38,stackoverflow.com\n');
    expect(map.get('google.com')).toBe(1);
    expect(map.get('stackoverflow.com')).toBe(38);
    expect(map.size).toBe(3);
  });
});

describe('trancoScoreFromRank', () => {
  it('rank 1 scores ~100 and decreases with worse ranks', () => {
    expect(trancoScoreFromRank(1).score).toBe(100);
    expect(trancoScoreFromRank(38).score).toBeLessThan(100);
    expect(trancoScoreFromRank(100).score).toBeGreaterThan(trancoScoreFromRank(100_000).score);
  });
  it('unranked domains get a low neutral score, not an error', () => {
    const { score, scoreLabel } = trancoScoreFromRank(undefined);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(20);
    expect(scoreLabel).toBe('未上榜');
  });
});

describe('scoreDomain', () => {
  const map = new Map<string, number>([['stackoverflow.com', 38]]);
  it('uses an injected rank map and normalizes the domain', () => {
    const s = scoreDomain('https://www.stackoverflow.com/q/1', map);
    expect(s.scoreLabel).toBe('排名 #38');
    expect(s.score).toBeGreaterThan(0);
  });
  it('falls back to neutral for an unlisted domain', () => {
    expect(scoreDomain('niche-blog.example', map).scoreLabel).toBe('未上榜');
  });
});
