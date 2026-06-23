import type { SourceResult, SourceRunner } from './types';

interface ExaResult {
  url: string;
  title?: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
}

/**
 * Exa neural search — surfaces individual long-form writing (essays, personal
 * blogs, newsletters) that keyword search buries. Mirrors makeTavilyRunner:
 * fetch is injectable for tests, non-2xx throws a descriptive error.
 */
export function makeExaRunner(apiKey: string, fetchFn: typeof fetch = fetch): SourceRunner {
  return {
    dimension: 'peoples_writing',
    api: 'exa',
    async run(query: string): Promise<SourceResult[]> {
      const res = await fetchFn('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          query,
          numResults: 5,
          type: 'auto',
          contents: { highlights: true }
        })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Exa ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as { results?: ExaResult[] };
      return (body.results ?? []).map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        // Prefer Exa's highlight passages; fall back to full text head. The trunk
        // still runs Jina extraction and only uses this snippet if extraction fails.
        snippet: (r.highlights?.join(' … ') || r.text || '').slice(0, 2000),
        publishedAt: r.publishedDate
      }));
    }
  };
}
