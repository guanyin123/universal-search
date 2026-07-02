import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRedditFetch, __resetRedditTokenCache } from './reddit-auth';

const auth = { clientId: 'cid', clientSecret: 'secret' };

const tokenResponse = () => ({ ok: true, json: async () => ({ access_token: 'tok-123', expires_in: 3600 }) }) as any;

beforeEach(() => __resetRedditTokenCache());

describe('makeRedditFetch', () => {
  it('returns the base fetch unchanged when no auth (keyless path)', () => {
    const base = vi.fn();
    expect(makeRedditFetch(undefined, base as any)).toBe(base);
  });

  it('mints a token then rewrites reddit URLs to oauth host + drops .json + adds Bearer', async () => {
    const base = vi.fn(async (url: any, _init?: any) => {
      if (String(url).includes('/api/v1/access_token')) return tokenResponse();
      return { ok: true, json: async () => ({ data: { subscribers: 1 } }) } as any;
    });
    const rf = makeRedditFetch(auth, base as any);
    await rf('https://www.reddit.com/r/MachineLearning/about.json', { headers: { 'User-Agent': 'x' } });

    // 1st call = token, Basic-authed
    expect(String(base.mock.calls[0][0])).toContain('/api/v1/access_token');
    expect(base.mock.calls[0][1]?.headers?.Authorization).toMatch(/^Basic /);
    // 2nd call = rewritten resource request
    const [url, init] = base.mock.calls[1];
    expect(String(url)).toBe('https://oauth.reddit.com/r/MachineLearning/about');
    expect((init as any).headers.Authorization).toBe('Bearer tok-123');
  });

  it('rewrites a subreddit search URL (keeps query, drops .json)', async () => {
    const base = vi.fn(async (url: any, _init?: any) =>
      String(url).includes('access_token') ? tokenResponse() : ({ ok: true, json: async () => ({}) } as any)
    );
    const rf = makeRedditFetch(auth, base as any);
    await rf('https://www.reddit.com/r/rust/search.json?q=async&restrict_sr=1');
    expect(String(base.mock.calls[1][0])).toBe('https://oauth.reddit.com/r/rust/search?q=async&restrict_sr=1');
  });

  it('reuses the cached token across calls (no second token fetch)', async () => {
    const base = vi.fn(async (url: any, _init?: any) =>
      String(url).includes('access_token') ? tokenResponse() : ({ ok: true, json: async () => ({}) } as any)
    );
    const rf = makeRedditFetch(auth, base as any);
    await rf('https://www.reddit.com/r/a/about.json');
    await rf('https://www.reddit.com/r/b/about.json');
    const tokenCalls = base.mock.calls.filter((c) => String(c[0]).includes('access_token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('passes non-Reddit URLs through untouched (no token, no Authorization)', async () => {
    const base = vi.fn(async (_url: any, _init?: any) => ({ ok: true, json: async () => ({}) }) as any);
    const rf = makeRedditFetch(auth, base as any);
    await rf('https://hn.algolia.com/api/v1/search?query=x');
    expect(base).toHaveBeenCalledTimes(1); // no token fetch
    expect(String(base.mock.calls[0][0])).toContain('hn.algolia.com');
    expect((base.mock.calls[0][1] as any)?.headers?.Authorization).toBeUndefined();
  });

  it('rejects the request when the token fetch fails (→ graceful per-source failure)', async () => {
    const base = vi.fn(async (_url: any, _init?: any) => ({ ok: false, status: 401, text: async () => 'bad creds' }) as any);
    const rf = makeRedditFetch(auth, base as any);
    await expect(rf('https://www.reddit.com/r/x/about.json')).rejects.toThrow(/Reddit token 401/);
  });
});
