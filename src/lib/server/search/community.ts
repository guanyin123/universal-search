import type { SourceResult, SourceRunner } from './types';
import type { CommunityTarget } from '../runs/types';

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

export const UA = 'universal-search/0.1 (local research app)';
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

type RedditListing = { data?: { children?: Array<{ data: RedditPost }> } };

function mapRedditPosts(body: RedditListing): SourceResult[] {
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

async function searchReddit(query: string, fetchFn: typeof fetch): Promise<SourceResult[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${PER_API}&sort=relevance`;
  // Reddit's public JSON refuses the default fetch UA; a descriptive UA keeps it keyless.
  const res = await fetchFn(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);
  return mapRedditPosts((await res.json()) as RedditListing);
}

const stripSub = (s: string) => s.replace(/^\/?r\//i, '').trim();

/** Search restricted to a single subreddit — the displayed "r/X" is what's actually searched. */
async function searchSubreddit(sub: string, query: string, fetchFn: typeof fetch): Promise<SourceResult[]> {
  const clean = stripSub(sub);
  const url =
    `https://www.reddit.com/r/${encodeURIComponent(clean)}/search.json` +
    `?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&limit=${PER_API}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Reddit r/${clean} ${res.status}`);
  return mapRedditPosts((await res.json()) as RedditListing);
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

export interface CommunityRunnerOptions {
  fetchFn?: typeof fetch;
  /** Domain-restricted web search for website targets, wired from Tavily.
   *  Absent (no web key) → website targets fail gracefully per-source. */
  siteSearch?: (query: string, domain: string) => Promise<SourceResult[]>;
  /** Broad open-web search (unconstrained Tavily) for the 'web' escape-hatch card. */
  webSearch?: (query: string) => Promise<SourceResult[]>;
  /** Broad "people's writing" search (Exa) for the 'writing' card, when configured. */
  writingSearch?: (query: string) => Promise<SourceResult[]>;
}

/**
 * Community + site pulse. With a named `target` the search is scoped to exactly
 * that target (subreddit / Hacker News / website domain) — the displayed name is
 * what's actually searched. Without a target it falls back to the legacy broad
 * Reddit+HN fan-out (one API failing degrades to the other; only if BOTH fail
 * does it throw, so the machine records a per-source failure rather than
 * synthesizing from nothing).
 */
export function makeCommunityRunner(opts: CommunityRunnerOptions = {}): SourceRunner {
  const fetchFn = opts.fetchFn ?? fetch;
  const { siteSearch, webSearch, writingSearch } = opts;
  return {
    dimension: 'community',
    api: 'community',
    async run(query: string, target?: CommunityTarget): Promise<SourceResult[]> {
      if (target?.kind === 'subreddit') {
        return (await searchSubreddit(target.value, query, fetchFn)).slice(0, MAX_RESULTS);
      }
      if (target?.kind === 'hn') {
        return (await searchHN(query, fetchFn)).slice(0, MAX_RESULTS);
      }
      if (target?.kind === 'domain') {
        if (!siteSearch) throw new Error(`Site search unavailable for ${target.value} (no web key)`);
        return (await siteSearch(query, target.value)).slice(0, MAX_RESULTS);
      }
      if (target?.kind === 'web') {
        if (!webSearch) throw new Error('Open-web search unavailable (no web key)');
        return (await webSearch(query)).slice(0, MAX_RESULTS);
      }
      if (target?.kind === 'writing') {
        if (!writingSearch) throw new Error('Writing search unavailable (no Exa key)');
        return (await writingSearch(query)).slice(0, MAX_RESULTS);
      }
      // Legacy / no-target: broad HN + Reddit interleave.
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
