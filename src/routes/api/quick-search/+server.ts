import { json, error } from '@sveltejs/kit';
import { getConfig } from '$lib/server/runtime-config';
import { makeTavilyRunner } from '$lib/server/search/tavily';

/**
 * Quick Search — a plain "search engine" pass: take a raw query, hit Tavily,
 * return link + title + snippet. Deliberately synchronous and stateless: NO run
 * record, NO SSE, NO LLM proposal / synthesis / vault deposit (unlike /api/run).
 */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const query = (body.query ?? '').toString().trim();
  if (!query) throw error(400, 'query is required');

  const cfg = getConfig();
  const runner = makeTavilyRunner(cfg.tavily.apiKey, fetch, 10);
  try {
    const results = await runner.run(query);
    return json({ results });
  } catch (err) {
    throw error(502, err instanceof Error ? err.message : 'search failed');
  }
}
