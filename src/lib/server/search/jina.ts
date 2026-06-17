/** Returns clean markdown for a URL via Jina Reader. Returns '' on failure (caller degrades gracefully). */
export function makeJinaExtractor(apiKey: string | undefined, fetchFn: typeof fetch = fetch) {
  return async function extract(url: string): Promise<string> {
    try {
      const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetchFn(`https://r.jina.ai/${url}`, { headers });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    }
  };
}
