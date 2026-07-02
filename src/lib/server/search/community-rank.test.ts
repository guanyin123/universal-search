import { describe, it, expect, vi } from 'vitest';
import { scoreSubreddit, scoreHn, subredditScoreFromSubs, formatCount } from './community-rank';

describe('subredditScoreFromSubs', () => {
  it('is monotonic and clamped to 0-100', () => {
    expect(subredditScoreFromSubs(0)).toBe(0);
    const small = subredditScoreFromSubs(1_000);
    const big = subredditScoreFromSubs(3_000_000);
    expect(big).toBeGreaterThan(small);
    expect(subredditScoreFromSubs(50_000_000)).toBeLessThanOrEqual(100);
    expect(subredditScoreFromSubs(50_000_000)).toBeGreaterThanOrEqual(0);
  });
});

describe('formatCount', () => {
  it('abbreviates millions and thousands', () => {
    expect(formatCount(2_900_000)).toBe('2.9M');
    expect(formatCount(12_300)).toBe('12.3K');
    expect(formatCount(900)).toBe('900');
  });
});

describe('scoreSubreddit', () => {
  it('reads subscriber count from about.json with a UA header', async () => {
    const fetchFn = vi.fn(async (_url: any, _init?: any) => ({
      ok: true,
      json: async () => ({ data: { subscribers: 2_900_000, display_name_prefixed: 'r/MachineLearning' } })
    }) as any);
    const out = await scoreSubreddit('MachineLearning', fetchFn as any);
    expect(out.label).toBe('r/MachineLearning');
    expect(out.scoreLabel).toBe('2.9M 订阅');
    expect(out.score).toBeGreaterThan(0);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/r/MachineLearning/about.json');
    expect(fetchFn.mock.calls[0][1]?.headers?.['User-Agent']).toBeTruthy();
  });

  it('rejects on a non-200 (private/banned/404) so the orchestrator drops it', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 }) as any);
    await expect(scoreSubreddit('doesnotexist', fetchFn as any)).rejects.toThrow();
  });

  it('rejects when subscriber count is missing', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }) as any);
    await expect(scoreSubreddit('private', fetchFn as any)).rejects.toThrow();
  });
});

describe('scoreHn', () => {
  it('is a fixed head-of-community score', () => {
    const s = scoreHn();
    expect(s.label).toBe('Hacker News');
    expect(s.score).toBeGreaterThan(80);
  });
});
