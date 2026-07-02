import type { SourceResult, SourceRunner } from './types';

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  published_date?: string;
}

export function makeTavilyRunner(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  maxResults = 5
): SourceRunner {
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
          max_results: maxResults,
          include_answer: false
        })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Tavily ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as { results?: TavilyResult[] };
      return mapTavilyResults(body.results);
    }
  };
}

function mapTavilyResults(results?: TavilyResult[]): SourceResult[] {
  return (results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.content,
    publishedAt: r.published_date
  }));
}

/**
 * A domain-restricted Tavily search — used by the community dimension's website
 * targets (Tavily `include_domains` confines results to that single site, so the
 * displayed domain is what's actually searched). Returns a thunk shaped for
 * makeCommunityRunner's `siteSearch` option.
 */
export function makeTavilySiteSearch(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  maxResults = 5
): (query: string, domain: string) => Promise<SourceResult[]> {
  return async (query: string, domain: string): Promise<SourceResult[]> => {
    const res = await fetchFn('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
        include_domains: [domain]
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Tavily ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as { results?: TavilyResult[] };
    return mapTavilyResults(body.results);
  };
}
