import type { Llm } from '../llm/client';
import type { PlanDimension, PlanSource, CommunityTarget } from '../runs/types';
import type { SourceRegion } from '../settings';
import { buildCommunityTargetsPrompt, parseCommunityProposal } from './propose';
import { scoreSubreddit as realScoreSubreddit, scoreHn as realScoreHn, type TargetScore } from '../search/community-rank';
import { scoreDomain as realScoreDomain } from '../search/tranco';

const TOP_N = 5; // show 5 for selection
const DEFAULT_SELECTED = 3; // default-select the top 3

interface ScoredTarget {
  target: CommunityTarget;
  score: number;
  label: string;
  scoreLabel: string;
}

/** Injectable scorers — production uses the real (network/file) ones; tests pass fakes. */
export interface CommunityScorers {
  scoreSubreddit: (name: string) => Promise<TargetScore>;
  scoreDomain: (domain: string) => { score: number; scoreLabel: string };
  scoreHn: () => TargetScore;
}

/** The real (network/file-backed) scorers. `redditFetch` carries Reddit OAuth when
 *  configured (else keyless global fetch). */
export function makeRealScorers(redditFetch: typeof fetch = fetch): CommunityScorers {
  return {
    scoreSubreddit: (n) => realScoreSubreddit(n, redditFetch),
    scoreDomain: realScoreDomain,
    scoreHn: realScoreHn
  };
}

/** Pure: order scored candidates, keep the top 5, default-enable the top 3. */
export function rankAndSelect(keywords: string, scored: ScoredTarget[]): PlanSource[] {
  return [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map((t, i) => ({
      id: `community-${i + 1}`,
      api: 'community',
      query: keywords,
      enabled: i < DEFAULT_SELECTED,
      target: t.target,
      label: t.label,
      scoreLabel: t.scoreLabel,
      score: t.score
    }));
}

/**
 * Build the community dimension as a RANKED, NAMED target picker:
 *   1. the model proposes ~8 subreddits/websites + one keyword query;
 *   2. Hacker News is prepended as a fixed head-of-community candidate;
 *   3. each candidate is scored by a real, free metric (Reddit subscribers /
 *      Tranco domain rank / HN fixed) in parallel — a per-candidate failure just
 *      drops that one;
 *   4. sort by score, keep the top 5, default-select (enable) the top 3.
 *
 * Throws if nothing could be proposed/scored so the caller can fall back to the
 * legacy free-text query proposal.
 */
/** Broad, low-trust escape-hatch cards, appended after the vetted picks and OFF by
 *  default — the opt-in discovery path (open web / Exa) the guardrail deliberately
 *  demotes. Only included when the corresponding runner exists. */
function broadCard(kind: 'web' | 'writing', value: string, label: string, keywords: string): PlanSource {
  return {
    id: '', // re-assigned sequentially by the caller
    api: 'community',
    query: keywords,
    enabled: false,
    target: { kind, value },
    label,
    scoreLabel: '宽泛 · 低信任',
    score: 0
  };
}

export async function buildCommunityDimension(
  question: string,
  llm: Llm,
  model: string,
  label: string,
  scorers: CommunityScorers = makeRealScorers(),
  broad: { web: boolean; writing: boolean } = { web: false, writing: false },
  region: SourceRegion = 'mixed'
): Promise<PlanDimension> {
  const raw = await llm.complete({ role: 'fanout', model, prompt: buildCommunityTargetsPrompt(question, region) });
  const { keywords, targets } = parseCommunityProposal(raw);

  // 国内 mode: sources must stay in-region — drop Reddit subreddits and don't prepend
  // Hacker News (both are foreign). Chinese domains proposed by the model score fine
  // via Tranco. 国外/混合 keep HN as the fixed head-of-community candidate.
  const proposed = region === 'domestic' ? targets.filter((t) => t.kind !== 'subreddit') : targets;
  const candidates: CommunityTarget[] = [
    ...(region === 'domestic' ? [] : [{ kind: 'hn' as const, value: 'hackernews' }]),
    ...proposed.map((t) => ({ kind: t.kind, value: t.value }))
  ];

  const scored = await Promise.allSettled(
    candidates.map(async (target): Promise<ScoredTarget> => {
      if (target.kind === 'subreddit') {
        return { target, ...(await scorers.scoreSubreddit(target.value)) };
      }
      if (target.kind === 'domain') {
        return { target, label: target.value, ...scorers.scoreDomain(target.value) };
      }
      return { target, ...scorers.scoreHn() }; // hn
    })
  );

  const ok = scored
    .filter((r): r is PromiseFulfilledResult<ScoredTarget> => r.status === 'fulfilled')
    .map((r) => r.value);

  const extras: PlanSource[] = [];
  if (broad.web) extras.push(broadCard('web', 'open-web', '开放网络搜索', keywords));
  if (broad.writing) extras.push(broadCard('writing', 'exa', '他人写作 (Exa)', keywords));

  // Vetted picks first (scored, top-3 enabled), then the OFF-by-default broad cards.
  const sources = [...rankAndSelect(keywords, ok), ...extras].map((s, i) => ({
    ...s,
    id: `community-${i + 1}`
  }));
  if (sources.length === 0) throw new Error('No search sources available');

  return { key: 'community', label, enabled: true, sources };
}
