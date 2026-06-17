import { describe, it, expect, vi } from 'vitest';
import { makeTavilyRunner } from './tavily';

describe('makeTavilyRunner', () => {
  it('POSTs the query and maps results to SourceResult[]', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { url: 'https://a.com', title: 'A', content: 'snippet A', published_date: '2026-01-01' },
          { url: 'https://b.com', title: 'B', content: 'snippet B' }
        ]
      })
    });
    const runner = makeTavilyRunner('tvly-x', fetchFn as any);
    const out = await runner.run('hello');

    expect(out).toEqual([
      { url: 'https://a.com', title: 'A', snippet: 'snippet A', publishedAt: '2026-01-01' },
      { url: 'https://b.com', title: 'B', snippet: 'snippet B', publishedAt: undefined }
    ]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(init.body).query).toBe('hello');
  });

  it('throws a descriptive error on non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    const runner = makeTavilyRunner('tvly-x', fetchFn as any);
    await expect(runner.run('q')).rejects.toThrow(/Tavily 401/);
  });
});
