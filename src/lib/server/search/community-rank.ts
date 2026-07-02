import { UA } from './community';

/**
 * Real, free, keyless popularity scoring for community targets:
 *   - subreddits → Reddit's public `r/{sub}/about.json` subscriber count
 *   - Hacker News → a fixed head-of-community score (no per-topic metric)
 *
 * Website domains are scored separately in `tranco.ts`. All three normalize onto
 * the same 0-100 scale so a mixed list (subreddits + HN + sites) can be ranked
 * together — a deliberately heuristic "recommended priority" the user can re-toggle.
 */

export interface TargetScore {
  score: number; // 0-100
  label: string; // display name, e.g. "r/MachineLearning"
  scoreLabel: string; // human detail, e.g. "2.9M 订阅"
}

interface AboutResponse {
  data?: { subscribers?: number | null; display_name_prefixed?: string; display_name?: string };
}

/** "2,900,000" → "2.9M"; "12,300" → "12.3K". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Pure: subscriber count → 0-100 score (~20M subscribers ≈ a full 100). */
export function subredditScoreFromSubs(subscribers: number): number {
  return Math.max(0, Math.min(100, Math.round((Math.log10(subscribers + 1) / 7.3) * 100)));
}

/** Score a subreddit by live subscriber count. Rejects on private/banned/404. */
export async function scoreSubreddit(name: string, fetchFn: typeof fetch = fetch): Promise<TargetScore> {
  const clean = name.replace(/^\/?r\//i, '').trim();
  const res = await fetchFn(`https://www.reddit.com/r/${encodeURIComponent(clean)}/about.json`, {
    headers: { 'User-Agent': UA }
  });
  if (!res.ok) throw new Error(`Reddit about r/${clean}: ${res.status}`);
  const body = (await res.json()) as AboutResponse;
  const subs = body.data?.subscribers;
  if (subs == null) throw new Error(`Reddit about r/${clean}: no subscriber count (private/banned?)`);
  return {
    score: subredditScoreFromSubs(subs),
    label: body.data?.display_name_prefixed ?? `r/${body.data?.display_name ?? clean}`,
    scoreLabel: `${formatCount(subs)} 订阅`
  };
}

/** Hacker News has no per-topic metric — a fixed head-of-community priority. */
export function scoreHn(): TargetScore {
  return { score: 92, label: 'Hacker News', scoreLabel: '头部技术社区' };
}
