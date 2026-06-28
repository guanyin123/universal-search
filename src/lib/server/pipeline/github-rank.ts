import type { SourceResult } from '../search/types';
import type { RankedRepo } from '../runs/types';

/** A strong-model judgment of one repo's real-world online reputation. */
export interface RepoJudgment {
  reputation: number; // 0-10
  reason: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Ask the strong model to judge each candidate's REAL-WORLD online reputation for the
 * user's need — drawing on what it knows the community says, not just the star count
 * (stars are scored separately). Output is a strict JSON array so parsing stays robust.
 */
export function buildRankPrompt(question: string, candidates: SourceResult[]): string {
  const list = candidates
    .map((c, i) => {
      const meta = [
        `stars: ${c.stars ?? 0}`,
        c.language ? `lang: ${c.language}` : '',
        c.topics?.length ? `topics: ${c.topics.slice(0, 6).join(', ')}` : '',
        c.pushedAt ? `last push: ${c.pushedAt.slice(0, 10)}` : ''
      ]
        .filter(Boolean)
        .join(' · ');
      return `${i + 1}. ${c.title} — ${c.snippet || '(no description)'} [${meta}]`;
    })
    .join('\n');

  return [
    'You judge GitHub repositories as candidate TOOLS for a user need.',
    'For EACH candidate, rate its real-world online reputation/quality on a 0-10 scale',
    '(maturity, maintenance, community trust, fitness for the need) — use what you know',
    'about the project, NOT just its star count. Give a one-line reason.',
    'Output ONLY a JSON array, one object per candidate, no prose, no markdown:',
    '[{ "name": "<owner/repo exactly as given>", "reputation": <0-10 number>, "reason": "<one short line>" }]',
    '',
    `User need: ${question}`,
    '',
    'Candidates:',
    list
  ].join('\n');
}

/** Parse the model's JSON array into a name→judgment map (keyed case-insensitively). */
export function parseRankJudgments(raw: string): Map<string, RepoJudgment> {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse rank array from model output: ${raw.slice(0, 120)}`);
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    throw new Error(`Could not parse rank array (invalid JSON): ${match[0].slice(0, 120)}`);
  }
  if (!Array.isArray(arr)) throw new Error('Parsed rank value is not an array');

  const out = new Map<string, RepoJudgment>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) continue;
    const rep = Number(o.reputation);
    out.set(name.toLowerCase(), {
      reputation: Number.isFinite(rep) ? clamp(rep, 0, 10) : 5,
      reason: String(o.reason ?? '').trim()
    });
  }
  return out;
}

/**
 * Combine GitHub stars (收藏数) with the model's reputation judgment (网上评价) into a
 * single score and return the top `limit` repos, highest first.
 *
 * - starScore: stars log-normalized to 0-10 WITHIN the candidate set (log so a 50k-star
 *   repo doesn't crush a solid 3k-star one; relative so the scale adapts per query).
 * - score: equal-weighted mean of starScore and reputation.
 *
 * `judgments` may be empty (e.g. the ranking LLM failed) — repos then fall back to a
 * neutral reputation of 5, i.e. effectively a stars-only ordering.
 */
export function rankRepos(
  candidates: SourceResult[],
  judgments: Map<string, RepoJudgment>,
  limit = 5
): RankedRepo[] {
  const maxStars = candidates.reduce((m, c) => Math.max(m, c.stars ?? 0), 0);
  const denom = Math.log10(maxStars + 1) || 1;

  return candidates
    .map((c): RankedRepo => {
      const stars = c.stars ?? 0;
      const starScore = maxStars > 0 ? (Math.log10(stars + 1) / denom) * 10 : 0;
      const j = judgments.get(c.title.toLowerCase());
      const reputation = j ? j.reputation : 5;
      const score = 0.5 * starScore + 0.5 * reputation;
      return {
        url: c.url,
        fullName: c.title,
        description: c.snippet,
        stars,
        language: c.language,
        license: c.license,
        pushedAt: c.pushedAt,
        topics: c.topics,
        reputation,
        score: Math.round(score * 100) / 100,
        reason: j?.reason ?? ''
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
