import type { SourceResult, SourceRunner } from './types';

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  license?: { spdx_id?: string | null } | null;
  pushed_at?: string;
  topics?: string[];
}

const UA = 'universal-search/0.1 (local research app)';
const PER_PAGE = 8;

/**
 * GitHub repository search. Keyless by default (anonymous; ~10 req/min) — a
 * GITHUB_TOKEN bumps the limit (~30 req/min) but is never required, so the mode
 * degrades gracefully on a fresh machine. Sorted by stars at the API so the
 * candidate pool is already the most-starred matches before reputation re-ranking.
 */
export function makeGithubRunner(token?: string, fetchFn: typeof fetch = fetch): SourceRunner {
  return {
    dimension: 'github',
    api: 'github',
    async run(query: string): Promise<SourceResult[]> {
      const url =
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
        `&sort=stars&order=desc&per_page=${PER_PAGE}`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': UA
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetchFn(url, { headers });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`GitHub ${res.status}: ${detail.slice(0, 200)}`);
      }
      const body = (await res.json()) as { items?: GitHubRepo[] };
      return (body.items ?? []).map((r) => ({
        url: r.html_url,
        title: r.full_name,
        snippet: r.description ?? '',
        stars: r.stargazers_count ?? 0,
        language: r.language ?? undefined,
        license: r.license?.spdx_id ?? undefined,
        pushedAt: r.pushed_at,
        topics: r.topics ?? []
      }));
    }
  };
}
