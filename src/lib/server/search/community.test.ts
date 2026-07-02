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
    const runner = makeCommunityRunner({ fetchFn: fetchFn as any });
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
    const runner = makeCommunityRunner({ fetchFn: fetchFn as any });
    const out = await runner.run('q');
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://news.ycombinator.com/item?id=111');
  });

  it('throws when BOTH APIs fail so the run records a source failure (never silently empty)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'err' }) as any);
    const runner = makeCommunityRunner({ fetchFn: fetchFn as any });
    await expect(runner.run('q')).rejects.toThrow(/community/i);
  });

  it('subreddit target → searches restricted to that subreddit (restrict_sr)', async () => {
    const fetchFn = vi.fn(async (_url: any) => ({ ok: true, json: async () => redditBody }) as any);
    const runner = makeCommunityRunner({ fetchFn: fetchFn as any });
    const out = await runner.run('rag', { kind: 'subreddit', value: 'MachineLearning' });

    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toContain('/r/MachineLearning/search.json');
    expect(url).toContain('restrict_sr=1');
    // Maps to the same Reddit SourceResult shape.
    expect(out[0].url).toBe('https://www.reddit.com/r/test/comments/abc/reddit_post/');
    // Did NOT touch HN.
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('hn.algolia.com'))).toBe(false);
  });

  it('hn target → searches Hacker News only', async () => {
    const fetchFn = vi.fn(async (_url: any) => ({ ok: true, json: async () => hnBody }) as any);
    const runner = makeCommunityRunner({ fetchFn: fetchFn as any });
    const out = await runner.run('rag', { kind: 'hn', value: 'hackernews' });

    expect(String(fetchFn.mock.calls[0][0])).toContain('hn.algolia.com');
    expect(out[0].url).toBe('https://news.ycombinator.com/item?id=111');
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('reddit.com'))).toBe(false);
  });

  it('domain target → delegates to injected siteSearch with the domain', async () => {
    const siteSearch = vi.fn(async (_q: string, _d: string) => [
      { url: 'https://stackoverflow.com/q/1', title: 'SO answer', snippet: 'x' }
    ]);
    const runner = makeCommunityRunner({ siteSearch });
    const out = await runner.run('rag', { kind: 'domain', value: 'stackoverflow.com' });

    expect(siteSearch).toHaveBeenCalledWith('rag', 'stackoverflow.com');
    expect(out[0].url).toBe('https://stackoverflow.com/q/1');
  });

  it('domain target without siteSearch → throws (graceful per-source fail)', async () => {
    const runner = makeCommunityRunner({});
    await expect(runner.run('rag', { kind: 'domain', value: 'stackoverflow.com' })).rejects.toThrow(/site search/i);
  });

  it('web target → delegates to injected webSearch (broad, unconstrained)', async () => {
    const webSearch = vi.fn(async (_q: string) => [{ url: 'https://x.com', title: 'X', snippet: 's' }]);
    const runner = makeCommunityRunner({ webSearch });
    const out = await runner.run('rag', { kind: 'web', value: 'open-web' });
    expect(webSearch).toHaveBeenCalledWith('rag');
    expect(out[0].url).toBe('https://x.com');
  });

  it('writing target → delegates to injected writingSearch (Exa)', async () => {
    const writingSearch = vi.fn(async (_q: string) => [{ url: 'https://essay.com', title: 'E', snippet: 's' }]);
    const runner = makeCommunityRunner({ writingSearch });
    const out = await runner.run('rag', { kind: 'writing', value: 'exa' });
    expect(writingSearch).toHaveBeenCalledWith('rag');
    expect(out[0].url).toBe('https://essay.com');
  });

  it('web / writing target without the injected search → throws (graceful per-source fail)', async () => {
    const runner = makeCommunityRunner({});
    await expect(runner.run('rag', { kind: 'web', value: 'open-web' })).rejects.toThrow(/unavailable/i);
    await expect(runner.run('rag', { kind: 'writing', value: 'exa' })).rejects.toThrow(/unavailable/i);
  });
});
