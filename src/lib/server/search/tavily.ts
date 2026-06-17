import type { SourceResult, SourceRunner } from './types';

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  published_date?: string;
}

export function makeTavilyRunner(apiKey: string, fetchFn: typeof fetch = fetch): SourceRunner {
  return {
    dimension: 'web',
    api: 'tavily',
    async run(query: string): Promise<SourceResult[]> {
      const res = await fetchFn('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: false
        })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Tavily ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as { results?: TavilyResult[] };
      return (body.results ?? []).map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.content,
        publishedAt: r.published_date
      }));
    }
  };
}
