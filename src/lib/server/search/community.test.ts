import { describe, it, expect, vi } from 'vitest';
import { makeCommunityRunner } from './community';

const hnBody = {
  hits: [
    {
      objectID: '111',
      title: 'HN Story',
      url: 'https://ext.com',
      points: 42,
      num_comments: 7,
      created_at: '2026-01-01T00:00:00.000Z'
    }
  ]
};
const redditBody = {
  data: {
    children: [
      {
        data: {
          title: 'Reddit Post',
          permalink: '/r/test/comments/abc/reddit_post/',
          subreddit: 'test',
          score: 12,
          num_comments: 3,
          selftext: 'body text',
          created_utc: 1700000000
        }
      }
    ]
  }
};

describe('makeCommunityRunner', () => {
  it('queries HN + Reddit, maps both to SourceResult[] and merges them', async () => {
    const fetchFn = vi.fn(async (url: any, _init?: any) => {
      if (String(url).includes('hn.algolia.com')) {
        return { ok: true, json: async () => hnBody } as any;
      }
      return { ok: true, json: async () => redditBody } as any;
    });
    const runner = makeCommunityRunner(fetchFn as any);
    const out = await runner.run('rag');

    expect(runner.dimension).toBe('community');
    expect(runner.api).toBe('community');

    const byUrl = Object.fromEntries(out.map((r) => [r.url, r]));
    // HN evidence points at the discussion thread, not the external link.
    const hn = byUrl['https://news.ycombinator.com/item?id=111'];
    expect(hn?.title).toBe('HN Story');
    expect(hn?.snippet).toContain('42 points');
    expect(hn?.publishedAt).toBe('2026-01-01T00:00:00.000Z');
    // Reddit evidence points at the comment thread.
    const reddit = byUrl['https://www.reddit.com/r/test/comments/abc/reddit_post/'];
    expect(reddit?.title).toBe('Reddit Post');
    expect(reddit?.snippet).toContain('r/test');

    // Reddit's public JSON requires a custom User-Agent.
    const redditCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('reddit.com'));
    expect(redditCall?.[1]?.headers?.['User-Agent']).toBeTruthy();
  });

  it('returns the surviving source when one API fails (Reddit down → HN only)', async () => {
    const fetchFn = vi.fn(async (url: any, _init?: any) => {
      if (String(url).includes('hn.algolia.com')) return { ok: true, json: async () => hnBody } as any;
      return { ok: false, status: 429, text: async () => 'rate limited' } as any;
    });
    const runner = makeCommunityRunner(fetchFn as any);
    const out = await runner.run('q');
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://news.ycombinator.com/item?id=111');
  });

  it('throws when BOTH APIs fail so the run records a source failure (never silently empty)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'err' }) as any);
    const runner = makeCommunityRunner(fetchFn as any);
    await expect(runner.run('q')).rejects.toThrow(/community/i);
  });
});
