import { describe, it, expect, vi } from 'vitest';
import { makeExaRunner } from './exa';

describe('makeExaRunner', () => {
  it('POSTs the query and maps results to SourceResult[]', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            url: 'https://essay.com/a',
            title: 'A',
            highlights: ['insight one', 'insight two'],
            publishedDate: '2026-01-01'
          },
          { url: 'https://blog.com/b', title: 'B', text: 'full body text' }
        ]
      })
    });
    const runner = makeExaRunner('exa-x', fetchFn as any);
    const out = await runner.run('hello');

    expect(runner.dimension).toBe('peoples_writing');
    expect(runner.api).toBe('exa');
    expect(out).toEqual([
      { url: 'https://essay.com/a', title: 'A', snippet: 'insight one … insight two', publishedAt: '2026-01-01' },
      { url: 'https://blog.com/b', title: 'B', snippet: 'full body text', publishedAt: undefined }
    ]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('exa-x');
    expect(init.headers['content-type']).toBe('application/json');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ query: 'hello', numResults: 5 });
  });

  it('falls back to the url as title when none is given', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ url: 'https://x.com', highlights: [] }] })
    });
    const runner = makeExaRunner('exa-x', fetchFn as any);
    const out = await runner.run('q');
    expect(out[0].title).toBe('https://x.com');
    expect(out[0].snippet).toBe('');
  });

  it('throws a descriptive error on non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    const runner = makeExaRunner('exa-x', fetchFn as any);
    await expect(runner.run('q')).rejects.toThrow(/Exa 401/);
  });
});
