import type { SourceResult, SourceRunner } from './types';

interface UnsplashPhoto {
  id: string;
  description?: string | null;
  alt_description?: string | null;
  urls?: { regular?: string; small?: string; full?: string };
  links?: { html?: string };
  user?: { name?: string; links?: { html?: string } };
  created_at?: string;
}

/**
 * Unsplash image search. Unlike the text runners, results carry an `imageUrl`
 * (the embeddable src) so the pipeline renders a Markdown figure instead of
 * fetching + text-compressing. `url` is the photo PAGE — the attribution target
 * Unsplash's API guidelines require crediting. fetch is injectable for tests.
 */
export function makeUnsplashRunner(accessKey: string, fetchFn: typeof fetch = fetch): SourceRunner {
  return {
    dimension: 'images',
    api: 'unsplash',
    async run(query: string): Promise<SourceResult[]> {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&content_filter=high`;
      const res = await fetchFn(url, {
        headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' }
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Unsplash ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as { results?: UnsplashPhoto[] };
      return (body.results ?? [])
        .filter((p) => p.urls?.regular || p.urls?.small)
        .map((p) => {
          const page = p.links?.html ?? `https://unsplash.com/photos/${p.id}`;
          const author = p.user?.name ?? 'Unknown';
          const authorLink = p.user?.links?.html ?? 'https://unsplash.com';
          return {
            url: page,
            title: p.description || p.alt_description || 'Untitled image',
            imageUrl: (p.urls!.regular ?? p.urls!.small)!,
            // Attribution per Unsplash API guidelines (photographer + Unsplash, both linked).
            snippet: `— 摄影 [${author}](${authorLink}) · [Unsplash](${page})`,
            publishedAt: p.created_at
          };
        });
    }
  };
}
