import type { SourceResult, SourceRunner } from './types';

interface HNHit {
  objectID: string;
  title?: string;
  url?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  story_text?: string;
}

interface RedditPost {
  title: string;
  permalink: string;
  subreddit?: string;
  score?: number;
  num_comments?: number;
  selftext?: string;
  created_utc?: number;
}

const UA = 'universal-search/0.1 (local research app)';
const PER_API = 5;
const MAX_RESULTS = 6;

const excerpt = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

async function searchHN(query: string, fetchFn: typeof fetch): Promise<SourceResult[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${PER_API}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HN ${res.status}`);
  const body = (await res.json()) as { hits?: HNHit[] };
  return (body.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      // Point at the HN discussion thread, not the external link — the comments
      // are the "community" signal we're after.
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: h.title!,
      snippet:
        `HN · ${h.points ?? 0} points · ${h.num_comments ?? 0} comments` +
        (h.story_text ? ` — ${excerpt(h.story_text)}` : ''),
      publishedAt: h.created_at
    }));
}

async function searchReddit(query: string, fetchFn: typeof fetch): Promise<SourceResult[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${PER_API}&sort=relevance`;
  // Reddit's public JSON refuses the default fetch UA; a descriptive UA keeps it keyless.
  const res = await fetchFn(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);
  const body = (await res.json()) as { data?: { children?: Array<{ data: RedditPost }> } };
  return (body.data?.children ?? [])
    .map((c) => c.data)
    .filter((d) => d?.title && d.permalink)
    .map((d) => ({
      url: `https://www.reddit.com${d.permalink}`,
      title: d.title,
      snippet:
        `r/${d.subreddit ?? '?'} · ${d.score ?? 0} points · ${d.num_comments ?? 0} comments` +
        (d.selftext ? ` — ${excerpt(d.selftext)}` : ''),
      publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined
    }));
}

/** Round-robin so a balanced mix of HN + Reddit survives the MAX_RESULTS cap. */
function interleave(a: SourceResult[], b: SourceResult[]): SourceResult[] {
  const out: SourceResult[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/**
 * Community pulse via Reddit + Hacker News — both keyless and free. Each query
 * fans out to both; one API failing degrades to the other (graceful), and only
 * if BOTH fail does run() throw so the machine records a per-source failure
 * rather than synthesizing from nothing.
 */
export function makeCommunityRunner(fetchFn: typeof fetch = fetch): SourceRunner {
  return {
    dimension: 'community',
    api: 'community',
    async run(query: string): Promise<SourceResult[]> {
      const [hn, reddit] = await Promise.allSettled([
        searchHN(query, fetchFn),
        searchReddit(query, fetchFn)
      ]);
      if (hn.status === 'rejected' && reddit.status === 'rejected') {
        throw new Error(`Community search failed: HN (${hn.reason}); Reddit (${reddit.reason})`);
      }
      const hnResults = hn.status === 'fulfilled' ? hn.value : [];
      const redditResults = reddit.status === 'fulfilled' ? reddit.value : [];
      return interleave(hnResults, redditResults).slice(0, MAX_RESULTS);
    }
  };
}
