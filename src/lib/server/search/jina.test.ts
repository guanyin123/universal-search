import { describe, it, expect, vi } from 'vitest';
import { makeJinaExtractor } from './jina';

describe('makeJinaExtractor', () => {
  it('fetches r.jina.ai/<url> and returns markdown text', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => '# Title\nbody' });
    const extract = makeJinaExtractor(undefined, fetchFn as any);
    const md = await extract('https://example.com/post');
    expect(md).toBe('# Title\nbody');
    expect(fetchFn.mock.calls[0][0]).toBe('https://r.jina.ai/https://example.com/post');
  });

  it('adds Authorization header when an api key is provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => 'x' });
    const extract = makeJinaExtractor('jina-key', fetchFn as any);
    await extract('https://e.com');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer jina-key');
  });

  it('returns empty string (does not throw) on failure so one bad source cannot kill the run', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const extract = makeJinaExtractor(undefined, fetchFn as any);
    expect(await extract('https://e.com')).toBe('');
  });

  it('returns empty string when fetch itself rejects (network error)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network failure'));
    const extract = makeJinaExtractor(undefined, fetchFn as any);
    expect(await extract('https://e.com')).toBe('');
  });
});
