import { describe, it, expect, vi } from 'vitest';
import { makeUnsplashRunner } from './unsplash';

describe('makeUnsplashRunner', () => {
  it('searches Unsplash and maps photos to image SourceResults with attribution', async () => {
    const fetchFn = vi.fn(async (_url: any, _init?: any) => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'abc',
            description: 'A calico cat',
            alt_description: 'cat on a sofa',
            urls: { regular: 'https://images.unsplash.com/abc?w=1080', small: 'https://images.unsplash.com/abc?w=400' },
            links: { html: 'https://unsplash.com/photos/abc' },
            user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } },
            created_at: '2026-01-01T00:00:00Z'
          }
        ]
      })
    }));
    const runner = makeUnsplashRunner('uns-key', fetchFn as any);
    const out = await runner.run('cats');

    expect(runner.dimension).toBe('images');
    expect(runner.api).toBe('unsplash');
    expect(out).toHaveLength(1);
    const r = out[0];
    // url points at the Unsplash photo page (attribution target), imageUrl is the embeddable src
    expect(r.url).toBe('https://unsplash.com/photos/abc');
    expect(r.imageUrl).toBe('https://images.unsplash.com/abc?w=1080');
    expect(r.title).toBe('A calico cat');
    expect(r.snippet).toContain('Jane Doe');
    expect(r.snippet).toContain('Unsplash');

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain('https://api.unsplash.com/search/photos');
    expect(String(url)).toContain('query=cats');
    expect(init.headers.Authorization).toBe('Client-ID uns-key');
  });

  it('falls back to alt_description then a placeholder title', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'x',
            description: null,
            alt_description: 'a mountain',
            urls: { regular: 'https://images.unsplash.com/x' },
            links: { html: 'https://unsplash.com/photos/x' },
            user: { name: 'Sam', links: { html: 'https://unsplash.com/@sam' } }
          }
        ]
      })
    }));
    const runner = makeUnsplashRunner('k', fetchFn as any);
    const out = await runner.run('q');
    expect(out[0].title).toBe('a mountain');
  });

  it('throws a descriptive error on non-ok response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' }));
    const runner = makeUnsplashRunner('k', fetchFn as any);
    await expect(runner.run('q')).rejects.toThrow(/Unsplash 401/);
  });
});
