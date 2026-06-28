import { describe, it, expect, vi } from 'vitest';
import { makeGithubRunner } from './github';

const sampleItems = {
  items: [
    {
      full_name: 'owner/repo-a',
      html_url: 'https://github.com/owner/repo-a',
      description: 'A fast thing',
      stargazers_count: 1200,
      language: 'Rust',
      license: { spdx_id: 'MIT' },
      pushed_at: '2026-06-01T00:00:00Z',
      topics: ['cli', 'search']
    },
    {
      full_name: 'owner/repo-b',
      html_url: 'https://github.com/owner/repo-b',
      description: null,
      stargazers_count: 50,
      language: null,
      license: null
    }
  ]
};

describe('makeGithubRunner', () => {
  it('queries repositories sorted by stars and maps GitHub fields to SourceResult[]', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleItems });
    const runner = makeGithubRunner(undefined, fetchFn as any);
    const out = await runner.run('vector database');

    expect(runner.dimension).toBe('github');
    expect(runner.api).toBe('github');
    expect(out).toEqual([
      {
        url: 'https://github.com/owner/repo-a',
        title: 'owner/repo-a',
        snippet: 'A fast thing',
        stars: 1200,
        language: 'Rust',
        license: 'MIT',
        pushedAt: '2026-06-01T00:00:00Z',
        topics: ['cli', 'search']
      },
      {
        url: 'https://github.com/owner/repo-b',
        title: 'owner/repo-b',
        snippet: '',
        stars: 50,
        language: undefined,
        license: undefined,
        pushedAt: undefined,
        topics: []
      }
    ]);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('https://api.github.com/search/repositories');
    expect(url).toContain('sort=stars');
    expect(url).toContain('order=desc');
    expect(url).toContain('per_page=8');
    expect(url).toContain(encodeURIComponent('vector database'));
    expect(init.headers.Accept).toBe('application/vnd.github+json');
    expect(init.headers.Authorization).toBeUndefined(); // anonymous when no token
  });

  it('adds a Bearer auth header when a token is provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    const runner = makeGithubRunner('ghp-x', fetchFn as any);
    await runner.run('q');
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer ghp-x');
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'rate limited' });
    const runner = makeGithubRunner(undefined, fetchFn as any);
    await expect(runner.run('q')).rejects.toThrow(/GitHub 403/);
  });
});
